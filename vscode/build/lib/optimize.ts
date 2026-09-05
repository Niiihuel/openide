/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import es from 'event-stream';
import { gulp, filter, sourcemaps, svgmin } from './gulp/facade.ts';
import path from 'path';
import fs from 'fs';
import os from 'os';
import pump from 'pump';
import VinylFile from 'vinyl';
import * as bundle from './bundle.ts';
import esbuild from 'esbuild';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import { getTargetStringFromTsConfig } from './tsconfigUtils.ts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

declare module 'gulp-sourcemaps' {
	interface WriteOptions {
		addComment?: boolean;
		includeContent?: boolean;
		sourceRoot?: string | WriteMapper;
		sourceMappingURL?: ((f: any) => string);
		sourceMappingURLPrefix?: string | WriteMapper;
		clone?: boolean | CloneOptions;
	}
}

const REPO_ROOT_PATH = path.join(import.meta.dirname, '../..');

export interface IBundleESMTaskOpts {
	/**
	 * The folder to read files from.
	 */
	src: string;
	/**
	 * The entry points to bundle.
	 */
	entryPoints: Array<bundle.IEntryPoint | string>;
	/**
	 * Other resources to consider (svg, etc.)
	 */
	resources?: string[];
	/**
	 * File contents interceptor for a given path.
	 */
	fileContentMapper?: (path: string) => ((contents: string) => Promise<string> | string) | undefined;
	/**
	 * Allows to skip the removal of TS boilerplate. Use this when
	 * the entry point is small and the overhead of removing the
	 * boilerplate makes the file larger in the end.
	 */
	skipTSBoilerplateRemoval?: (entryPointName: string) => boolean;
}

const DEFAULT_FILE_HEADER = [
	'/*!--------------------------------------------------------',
	' * Copyright (C) Microsoft Corporation. All rights reserved.',
	' *--------------------------------------------------------*/'
].join('\n');

/**
 * OPENIDE: how many entry points may be bundled at the same time.
 *
 * The loop below starts an esbuild build for every entry point and only then awaits them, so all 23
 * ran at once -- the whole workbench bundled concurrently, each holding its output and source map
 * in memory because `write: false` keeps `res.outputFiles` there. That is the peak of the entire
 * build, and on a 7 GB CI runner it is over the line: the four release platforms all died at this
 * exact moment, Linux by having the runner agent killed (no error at all, just "The runner has
 * received a shutdown signal") and Windows with esbuild's own "The service was stopped".
 *
 * Bounding it trades some wall-clock for a peak that fits. Unlike adding swap or resizing a
 * pagefile, this works regardless of the machine, which matters because Windows has no reliable
 * equivalent to the Linux swapfile.
 *
 * Derived from RAM rather than CPU count: the constraint being hit is memory, and CI runners pair
 * few cores with little RAM in ways that do not track each other.
 */
const BUNDLE_CONCURRENCY = (() => {
	const override = Number(process.env['VSCODE_BUNDLE_CONCURRENCY']);
	if (Number.isInteger(override) && override > 0) {
		return override;
	}
	// Roughly 1.5 GB per concurrent bundle, leaving 2 GB for everything else. Floor of 2 so a small
	// machine still makes progress; cap of 8 because past that the disk and the GC dominate anyway.
	const budgetGb = os.totalmem() / (1024 ** 3) - 2;
	return Math.max(2, Math.min(8, Math.floor(budgetGb / 1.5)));
})();

/** Resolves when a slot is free; the returned function gives it back. */
function createLimiter(limit: number): () => Promise<() => void> {
	let active = 0;
	const waiting: (() => void)[] = [];

	const release = () => {
		active--;
		waiting.shift()?.();
	};

	return async () => {
		if (active >= limit) {
			await new Promise<void>(resolve => waiting.push(resolve));
		}
		active++;
		return release;
	};
}

function bundleESMTask(opts: IBundleESMTaskOpts): NodeJS.ReadWriteStream {
	const resourcesStream = es.through(); // this stream will contain the resources
	const bundlesStream = es.through(); // this stream will contain the bundled files

	const target = getBuildTarget();

	const entryPoints = opts.entryPoints.map(entryPoint => {
		if (typeof entryPoint === 'string') {
			return { name: path.parse(entryPoint).name };
		}

		return entryPoint;
	});

	const bundleAsync = async () => {
		const files: VinylFile[] = [];
		const tasks: Promise<any>[] = [];
		const acquire = createLimiter(BUNDLE_CONCURRENCY);

		fancyLog(`Bundling ${entryPoints.length} entry points, ${BUNDLE_CONCURRENCY} at a time...`);

		for (const entryPoint of entryPoints) {
			// Awaited here rather than around the build alone, so the log line marks a bundle that is
			// actually starting. Every one printing at the same instant was the clue that they all
			// ran at once.
			const release = await acquire();
			fancyLog(`Bundled entry point: ${ansiColors.yellow(entryPoint.name)}...`);

			// support for 'dest' via esbuild#in/out
			const dest = entryPoint.dest?.replace(/\.[^/.]+$/, '') ?? entryPoint.name;

			// banner contents
			const banner = {
				js: DEFAULT_FILE_HEADER,
				css: DEFAULT_FILE_HEADER
			};

			// TS Boilerplate
			if (!opts.skipTSBoilerplateRemoval?.(entryPoint.name)) {
				const tslibPath = path.join(require.resolve('tslib'), '../tslib.es6.js');
				banner.js += await fs.promises.readFile(tslibPath, 'utf-8');
			}

			const contentsMapper: esbuild.Plugin = {
				name: 'contents-mapper',
				setup(build) {
					build.onLoad({ filter: /\.js$/ }, async ({ path }) => {
						const contents = await fs.promises.readFile(path, 'utf-8');

						// TS Boilerplate
						let newContents: string;
						if (!opts.skipTSBoilerplateRemoval?.(entryPoint.name)) {
							newContents = bundle.removeAllTSBoilerplate(contents);
						} else {
							newContents = contents;
						}

						// File Content Mapper
						const mapper = opts.fileContentMapper?.(path.replace(/\\/g, '/'));
						if (mapper) {
							newContents = await mapper(newContents);
						}

						return { contents: newContents };
					});
				}
			};

			const externalOverride: esbuild.Plugin = {
				name: 'external-override',
				setup(build) {
					// We inline selected modules that are we depend on on startup without
					// a conditional `await import(...)` by hooking into the resolution.
					build.onResolve({ filter: /^minimist$/ }, () => {
						return { path: path.join(REPO_ROOT_PATH, 'node_modules', 'minimist', 'index.js'), external: false };
					});
				},
			};

			const task = esbuild.build({
				bundle: true,
				packages: 'external', // "external all the things", see https://esbuild.github.io/api/#packages
				platform: 'neutral', // makes esm
				format: 'esm',
				sourcemap: 'external',
				plugins: [contentsMapper, externalOverride],
				target: [target],
				loader: {
					'.ttf': 'file',
					'.svg': 'file',
					'.png': 'file',
					'.sh': 'file',
				},
				assetNames: 'media/[name]', // moves media assets into a sub-folder "media"
				banner,
				entryPoints: [
					{
						in: path.join(REPO_ROOT_PATH, opts.src, `${entryPoint.name}.js`),
						out: dest,
					}
				],
				outdir: path.join(REPO_ROOT_PATH, opts.src),
				write: false, // enables res.outputFiles
				metafile: true, // enables res.metafile
				// minify: NOT enabled because we have a separate minify task that takes care of the TSLib banner as well
			}).then(res => {
				for (const file of res.outputFiles) {
					let sourceMapFile: esbuild.OutputFile | undefined = undefined;
					if (file.path.endsWith('.js')) {
						sourceMapFile = res.outputFiles.find(f => f.path === `${file.path}.map`);
					}

					const fileProps = {
						contents: Buffer.from(file.contents),
						sourceMap: sourceMapFile ? JSON.parse(sourceMapFile.text) : undefined, // support gulp-sourcemaps
						path: file.path,
						base: path.join(REPO_ROOT_PATH, opts.src)
					};
					files.push(new VinylFile(fileProps));
				}
			});

			// The loop now awaits between iterations, so a build can reject while later entry points are
			// still being queued -- long before `Promise.all` below is reached. Without a handler in
			// place by then, Node treats it as an unhandled rejection and kills the process, which
			// would turn a readable esbuild error into a crash with no useful message. This keeps it
			// handled; `Promise.all` still reports it.
			const settled = task.finally(release);
			settled.catch(() => { /* reported by Promise.all */ });
			tasks.push(settled);
		}

		await Promise.all(tasks);
		return { files };
	};

	bundleAsync().then((output) => {

		// bundle output (JS, CSS, SVG...)
		es.readArray(output.files).pipe(bundlesStream);

		// forward all resources
		gulp.src(opts.resources ?? [], { base: `${opts.src}`, allowEmpty: true }).pipe(resourcesStream);
	});

	const result = es.merge(
		bundlesStream,
		resourcesStream
	);

	return result
		.pipe(sourcemaps.write('./', {
			sourceRoot: undefined,
			addComment: true,
			includeContent: true
		}));
}

export interface IBundleTaskOpts {
	/**
	 * Destination folder for the bundled files.
	 */
	out: string;
	/**
	 * Bundle ESM modules (using esbuild).
	*/
	esm: IBundleESMTaskOpts;
}

export function bundleTask(opts: IBundleTaskOpts): () => NodeJS.ReadWriteStream {
	return function () {
		return bundleESMTask(opts.esm).pipe(gulp.dest(opts.out));
	};
}

export function minifyTask(src: string, sourceMapBaseUrl?: string): (cb: any) => void {
	const sourceMappingURL = sourceMapBaseUrl ? ((f: any) => `${sourceMapBaseUrl}-${f.relative.replaceAll('/', '-')}.map`) : undefined;
	const target = getBuildTarget();

	return cb => {

		const esbuildFilter = filter('**/*.{js,css}', { restore: true });
		const svgFilter = filter('**/*.svg', { restore: true });

		pump(
			gulp.src([src + '/**', '!' + src + '/**/*.map']),
			esbuildFilter,
			sourcemaps.init({ loadMaps: true }),
			es.map((f: any, cb) => {
				esbuild.build({
					entryPoints: [f.path],
					minify: true,
					sourcemap: 'external',
					outdir: '.',
					packages: 'external', // "external all the things", see https://esbuild.github.io/api/#packages
					platform: 'neutral', // makes esm
					target: [target],
					write: false,
				}).then(res => {
					const jsOrCSSFile = res.outputFiles.find(f => /\.(js|css)$/.test(f.path))!;
					const sourceMapFile = res.outputFiles.find(f => /\.(js|css)\.map$/.test(f.path))!;

					const contents = Buffer.from(jsOrCSSFile.contents);
					const unicodeMatch = contents.toString().match(/[^\x00-\xFF]+/g);
					if (unicodeMatch) {
						cb(new Error(`Found non-ascii character ${unicodeMatch[0]} in the minified output of ${f.path}. Non-ASCII characters in the output can cause performance problems when loading. Please review if you have introduced a regular expression that esbuild is not automatically converting and convert it to using unicode escape sequences.`));
					} else {
						f.contents = contents;
						f.sourceMap = JSON.parse(sourceMapFile.text);

						cb(undefined, f);
					}
				}, cb);
			}),
			esbuildFilter.restore,
			svgFilter,
			svgmin(),
			svgFilter.restore,
			sourcemaps.write('./', {
				sourceMappingURL,
				sourceRoot: undefined,
				includeContent: true,
				addComment: true
			}),
			gulp.dest(src + '-min'),
			(err: any) => cb(err));
	};
}

function getBuildTarget() {
	const tsconfigPath = path.join(REPO_ROOT_PATH, 'src', 'tsconfig.base.json');
	return getTargetStringFromTsConfig(tsconfigPath);
}

