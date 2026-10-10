// scripts/layoutScan.mjs の型（tests/layout.slow.test.ts から使う）
import type { Browser, Page } from '@playwright/test';

export type ScanSize = { name: string; width: number; height: number };
export const SCAN_SIZES: ScanSize[];
export const SCAN_LANGS: string[];
export const SCREENS: [string, (p: Page) => Promise<unknown>][];
export function scanPage(page: Page): Promise<string[]>;
export function seedSave(page: Page, lang: string): Promise<void>;
export function scanAll(
  browser: Browser,
  base: string,
  opts?: { sizes?: ScanSize[]; langs?: string[]; screens?: [string, (p: Page) => Promise<unknown>][]; onShot?: (page: Page, name: string) => Promise<void> },
): Promise<string[]>;
