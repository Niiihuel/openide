import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {site} from '@/lib/site';

export const metadata: Metadata = {
  title: site.name,
  description: 'OpenIDE: an open IDE built on VS Code, with an AI agent built into the product.',
  robots: {index: false, follow: true},
};

export default function RootRedirectLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
