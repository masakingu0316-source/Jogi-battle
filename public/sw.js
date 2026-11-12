// 定規バトルのサービスワーカー（ホーム画面に追加できるようにするためのもの）。
// 対戦は常に最新の版で行うので、ページやデータは保存せず、毎回ネットから読む。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
