import { createServer } from 'vite';
import qrcode from 'qrcode-terminal';

const server = await createServer({
  server: { host: '0.0.0.0', port: 5173, strictPort: true }
});

try {
  await server.listen();
  server.printUrls();

  const networkUrls = (server.resolvedUrls?.network ?? []).filter(url => {
    const host = new URL(url).hostname;
    return host !== '0.0.0.0' && !host.startsWith('169.254.');
  });

  if (networkUrls.length === 0) {
    console.warn('\n找不到可供手機掃描的區網 IPv4 網址；請檢查電腦的網路連線。');
  } else {
    for (const url of [...new Set(networkUrls)]) {
      console.log(`\n手機掃描以下 QR code（同一 Wi-Fi）：${url}`);
      qrcode.generate(url, { small: true });
    }
  }
} catch (error) {
  await server.close();
  console.error(error);
  process.exitCode = 1;
}
