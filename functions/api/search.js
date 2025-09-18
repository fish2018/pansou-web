export default {
  async fetch(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    // 把请求原样转发到真实后端
    const upstream = await fetch('https://pansou.ml/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': req.headers.get('User-Agent')
      },
      body: req.body
    });

    // 把上游响应加上 CORS 头，方便前端调用
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST'
      }
    });
  }
};
