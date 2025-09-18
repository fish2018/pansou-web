// 所有未匹配静态资源或未命中 Functions 的请求都回退到 SPA
export default {
  async fetch(req, env) {
    return env.ASSETS.fetch(new Request('/index.html', req));
  }
};
