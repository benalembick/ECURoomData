const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const port = process.env.PORT || 3000;
const distDir = path.join(__dirname, 'dist');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function sendFile(response, filePath) {
  fs.readFile(filePath, function (error, contents) {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Server error');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    });
    response.end(contents);
  });
}

http
  .createServer(function (request, response) {
    const parsedUrl = url.parse(request.url);
    const safePath = path
      .normalize(decodeURIComponent(parsedUrl.pathname))
      .replace(/^(\.\.[/\\])+/, '');

    let filePath = path.join(distDir, safePath);

    if (safePath === '/' || !path.extname(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }

    fs.stat(filePath, function (error, stats) {
      if (!error && stats.isFile()) {
        sendFile(response, filePath);
        return;
      }

      sendFile(response, path.join(distDir, 'index.html'));
    });
  })
  .listen(port, function () {
    console.log('ECU Room Data Hub listening on port ' + port);
  });
