import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createStaticServer } from './static-server.mjs';

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const roots = ['out', 'dist/client', 'dist'].map((p) => path.join(project, p));
const root = roots.find((p) => fs.existsSync(path.join(p, 'index.html')));
if (!root) {
  console.error('尚未生成网页，请先在项目目录运行 npm run build。');
  process.exit(1);
}
const server = createStaticServer(root);
let port = Number(process.env.SELENE_PORT || 3000);
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port < 3010) {
    port++;
    server.listen(port, '127.0.0.1');
  } else {
    console.error(error.message);
    process.exit(1);
  }
});
server.on('listening', () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(
    `\nSELENE · 月面漫游\n本地网页已启动：${url}\n按 Ctrl+C 关闭。\n`,
  );
  if (process.argv.includes('--open')) {
    const command =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer.exe'
          : 'xdg-open';
    spawn(command, [url], { stdio: 'ignore' }).on('error', () => {});
  }
});
server.listen(port, '127.0.0.1');
