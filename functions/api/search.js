// Cloudflare Functions API处理搜索请求
export async function onRequestPost(context) {
  const { request } = context;
  
  try {
    // 获取请求体
    const body = await request.clone().text();
    
    // 把请求转发到真实后端API
    // 注意：这里需要替换为您的实际后端API地址，不能是当前Worker的地址
    const upstream = await fetch('https://api.xueximeng.com/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': request.headers.get('User-Agent')
      },
      body: body
    });

    // 获取上游响应
    const upstreamData = await upstream.text();
    
    // 返回响应并添加CORS头
    return new Response(upstreamData, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (error) {
    console.error('搜索API错误:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 处理OPTIONS请求（CORS预检）
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
