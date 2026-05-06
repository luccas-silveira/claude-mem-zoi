#!/usr/bin/env node

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const ZOI_DS_PKG_DIR = path.join(rootDir, 'node_modules/@zoitechnologies/ds');
const ZOI_DS_MARKER_START = '<!-- ZOI-DS:START -->';
const ZOI_DS_MARKER_END = '<!-- ZOI-DS:END -->';

function buildZoiDsBlock() {
  const pkgPath = path.join(ZOI_DS_PKG_DIR, 'package.json');
  const themePath = path.join(ZOI_DS_PKG_DIR, 'styles/theme.css');
  const styleguidePath = path.join(ZOI_DS_PKG_DIR, 'styleguide/index.html');

  if (!fs.existsSync(pkgPath) || !fs.existsSync(themePath)) {
    throw new Error(
      `@zoitechnologies/ds not found at ${ZOI_DS_PKG_DIR}. Run npm install.`
    );
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const themeCss = fs.readFileSync(themePath, 'utf-8');

  let darkBlock = '';
  if (fs.existsSync(styleguidePath)) {
    const styleguide = fs.readFileSync(styleguidePath, 'utf-8');
    const darkMatch = styleguide.match(/\[data-theme="dark"\]\s*\{[\s\S]*?\}/);
    if (darkMatch) {
      darkBlock = `\n/* Dark theme — extracted from styleguide/index.html (DS exports light-only theme.css) */\n${darkMatch[0]}\n`;
    } else {
      console.warn('⚠ Dark theme block not found in styleguide; output will be light-only.');
    }
  } else {
    console.warn('⚠ styleguide/index.html not found; output will be light-only.');
  }

  const header = `/* @zoitechnologies/ds v${pkg.version} — embedded by scripts/build-viewer.js (do not edit; sourced from node_modules) */`;
  return [
    ZOI_DS_MARKER_START,
    `<style id="zoi-ds-tokens">`,
    header,
    themeCss.trim(),
    darkBlock.trim(),
    `</style>`,
    ZOI_DS_MARKER_END,
  ].join('\n');
}

function injectZoiDs(html, block) {
  const re = new RegExp(
    `${ZOI_DS_MARKER_START}[\\s\\S]*?${ZOI_DS_MARKER_END}`,
    'm'
  );
  if (re.test(html)) {
    return html.replace(re, block);
  }
  return html.replace(/<head>/i, `<head>\n${block}`);
}

async function buildViewer() {
  console.log('Building React viewer...');

  try {
    await esbuild.build({
      entryPoints: [path.join(rootDir, 'src/ui/viewer/index.tsx')],
      bundle: true,
      minify: true,
      sourcemap: false,
      target: ['es2020'],
      format: 'iife',
      outfile: path.join(rootDir, 'plugin/ui/viewer-bundle.js'),
      jsx: 'automatic',
      loader: {
        '.tsx': 'tsx',
        '.ts': 'ts'
      },
      define: {
        'process.env.NODE_ENV': '"production"'
      }
    });

    const htmlTemplate = fs.readFileSync(
      path.join(rootDir, 'src/ui/viewer-template.html'),
      'utf-8'
    );
    const zoiDsBlock = buildZoiDsBlock();
    const htmlWithDs = injectZoiDs(htmlTemplate, zoiDsBlock);
    fs.writeFileSync(
      path.join(rootDir, 'plugin/ui/viewer.html'),
      htmlWithDs
    );

    const fontsDir = path.join(rootDir, 'src/ui/viewer/assets/fonts');
    const outputFontsDir = path.join(rootDir, 'plugin/ui/assets/fonts');

    if (fs.existsSync(fontsDir)) {
      fs.mkdirSync(outputFontsDir, { recursive: true });
      const fontFiles = fs.readdirSync(fontsDir);
      for (const file of fontFiles) {
        fs.copyFileSync(
          path.join(fontsDir, file),
          path.join(outputFontsDir, file)
        );
      }
    }

    const srcUiDir = path.join(rootDir, 'src/ui');
    const outputUiDir = path.join(rootDir, 'plugin/ui');
    const iconFiles = fs.readdirSync(srcUiDir).filter(file => file.startsWith('icon-thick-') && file.endsWith('.svg'));
    for (const file of iconFiles) {
      fs.copyFileSync(
        path.join(srcUiDir, file),
        path.join(outputUiDir, file)
      );
    }

    console.log('✓ React viewer built successfully');
    console.log('  - plugin/ui/viewer-bundle.js');
    console.log('  - plugin/ui/viewer.html (from viewer-template.html + @zoitechnologies/ds)');
    console.log('  - plugin/ui/assets/fonts/* (font files)');
    console.log(`  - plugin/ui/icon-thick-*.svg (${iconFiles.length} icon files)`);
  } catch (error) {
    console.error('Failed to build viewer:', error);
    process.exit(1);
  }
}

buildViewer();
