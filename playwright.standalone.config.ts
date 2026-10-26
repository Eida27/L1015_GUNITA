import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Started by the guarded disposable harness, never a development fallback.
export default defineConfig({ ...base, webServer: undefined });
