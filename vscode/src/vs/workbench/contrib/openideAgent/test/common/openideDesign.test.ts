/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { changeDesign, DESIGN_TEMPLATES, designHandoff, newDesign, validateDesign } from '../../common/openideDesign.js';

suite('OpenIDE structured Canvas', () => {
	test('all available templates have valid documents and resolvable interactions', () => { for (const template of DESIGN_TEMPLATES) { const file=newDesign(template.id,'Test');assert.deepStrictEqual(validateDesign(file),file); } });
	test('edits, undo and redo preserve IDs with monotonic revisions', () => {
		const initial=newDesign('mobile','Checkout');const edited=changeDesign(initial,1,[{type:'setNode',id:'heading',text:'Buy now'}]);const undone=changeDesign(edited,2,'undo');const redone=changeDesign(undone,3,'redo');
		assert.deepStrictEqual([edited.document.screens[0].nodes[0].text,undone.document.screens[0].nodes[0].text,redone.document.screens[0].nodes[0].text,redone.revision,redone.document.screens[0].nodes[0].id],['Buy now','Checkout','Buy now',4,'heading']);
	});
	test('stale patches cannot overwrite a manual edit', () => { const edited=changeDesign(newDesign('mockup','Test'),1,[{type:'setToken',token:'accent',value:'#aabbcc'}]);assert.throws(()=>changeDesign(edited,1,[{type:'setNode',id:'heading',text:'Stale'}]),/Design changed/);assert.strictEqual(edited.document.tokens.accent,'#aabbcc'); });
	test('a failed operation batch leaves the original document intact', () => {const original=newDesign('mockup','Original');assert.throws(()=>changeDesign(original,1,[{type:'setNode',id:'heading',text:'New'},{type:'removeScreen',id:'detail'}]),/destination/);assert.strictEqual(original.document.screens[0].nodes[0].text,'Original');});
	test('duplicate variants get new IDs while comments remain on their original node', () => {const source=changeDesign(newDesign('mockup','Test'),1,[{type:'comment',id:'heading',text:'Keep this'}]);const result=changeDesign(source,2,[{type:'duplicateScreen',screenId:'main',id:'variant'}]);assert.deepStrictEqual([result.document.screens[2].nodes[0].id,result.document.comments[0].nodeId],['variant-heading','heading']);});
	test('malformed documents and tokens fail closed', () => {const file=newDesign('wireframe','Test');file.document.screens[0].nodes[0].id='detail';assert.throws(()=>validateDesign(file),/unique/);assert.throws(()=>changeDesign(newDesign('blank','Test'),1,[{type:'setToken',token:'accent',value:'url(https://example.com)'}]),/hex colors/);});
	test('moving into a descendant cannot create a cyclic tree or lose a node', () => {const file=newDesign('blank','Test');file.document.screens[0].nodes=[{id:'parent',kind:'box',text:'Parent',token:'text',spacing:10,size:14,children:[{id:'child',kind:'box',text:'Child',token:'text',spacing:10,size:14,children:[]}]}];assert.throws(()=>changeDesign(file,1,[{type:'moveNode',id:'parent',parentId:'child'}]),/destination/);assert.strictEqual(file.document.screens[0].nodes.length,1);});
	test('handoff carries revision and verification criteria, without claiming completion',()=>{const result=designHandoff(newDesign('mobile','Checkout'));assert.match(result,/Design revision: 1/);assert.match(result,/submit → detail/);assert.match(result,/Verify mobile and desktop/);assert.match(result,/before marking a GOAL complete/);});
});
