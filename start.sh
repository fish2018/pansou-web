#!/bin/bash
set -e

# 环境变量默认值
export PANSOU_PORT=${PANSOU_PORT:-8888}
export PANSOU_HOST=${PANSOU_HOST:-127.0.0.1}
export DOMAIN=${DOMAIN:-localhost}
export CACHE_PATH=${CACHE_PATH:-/app/data/cache}
export LOG_PATH=${LOG_PATH:-/app/data/logs}

# 健康检查配置
export HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-30}
export HEALTH_CHECK_TIMEOUT=${HEALTH_CHECK_TIMEOUT:-10}
export HEALTH_CHECK_RETRIES=${HEALTH_CHECK_RETRIES:-3}

echo "========================================"
echo "正在启动PanSou服务"
echo "========================================"
echo "配置信息："
echo "- 后端地址: ${PANSOU_HOST}:${PANSOU_PORT}"
echo "- 域名: ${DOMAIN}"
echo "- 前端目录: /app/frontend/dist"
echo "- 缓存目录: ${CACHE_PATH}"
echo "- 日志目录: ${LOG_PATH}"
echo "- 健康检查间隔: ${HEALTH_CHECK_INTERVAL}秒"
echo "========================================"

# 创建必要的目录（统一在/app/data下）
mkdir -p /app/data/cache
mkdir -p /app/data/logs/backend
mkdir -p /app/data/logs/nginx
mkdir -p /app/data/ssl

# 为nginx日志创建软链接（nginx默认在/var/log/nginx写日志）
rm -rf /var/log/nginx
ln -sf /app/data/logs/nginx /var/log/nginx

# 检测SSL证书是否存在
SSL_AVAILABLE=false
if [ -f "/app/data/ssl/fullchain.pem" ] && [ -f "/app/data/ssl/privkey.pem" ]; then
    SSL_AVAILABLE=true
    echo "✓ 检测到SSL证书，将启用HTTPS"
else
    echo "○ 未检测到SSL证书，将仅使用HTTP"
fi

# 动态生成Nginx配置
cat > /etc/nginx/conf.d/default.conf << EOF
# HTTP服务器
server {
    listen 8080;
    server_name ${DOMAIN};
    
    # 设置客户端最大请求体大小
    client_max_body_size 50M;
    # 压缩
    gzip on;
    gzip_buffers 32 4K;
    gzip_comp_level 9;
    gzip_min_length 100;
    gzip_types text/plain application/xml application/json application/javascript text/css text/xml application/x-javascript;
    gzip_disable "MSIE [1-6]\."; #配置禁用gzip条件，支持正则。此处表示ie6及以下不启用gzip（因为ie低版本不支持）
    gzip_vary on;
    
    # 日志配置（统一到/app/data/logs/nginx）
    access_log /app/data/logs/nginx/access.log;
    error_log /app/data/logs/nginx/error.log;

$(if [ "$SSL_AVAILABLE" = true ]; then
    echo "    # 如果SSL可用，重定向到HTTPS"
    echo "    return 301 https://\$host\$request_uri;"
    echo "}"
    echo ""
    echo "# HTTPS服务器"
    echo "server {"
    echo "    listen 443 ssl http2;"
    echo "    server_name ${DOMAIN};"
    echo ""
    echo "    # SSL配置"
    echo "    ssl_certificate /app/data/ssl/fullchain.pem;"
    echo "    ssl_certificate_key /app/data/ssl/privkey.pem;"
    echo "    ssl_protocols TLSv1.2 TLSv1.3;"
    echo "    ssl_prefer_server_ciphers on;"
    echo "    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;"
    echo "    ssl_session_timeout 1d;"
    echo "    ssl_session_cache shared:SSL:10m;"
    echo "    ssl_session_tickets off;"
    echo ""
    echo "    # 安全头部"
    echo "    add_header Strict-Transport-Security \"max-age=63072000; includeSubDomains; preload\" always;"
    echo "    add_header X-Content-Type-Options nosniff;"
    echo "    add_header X-Frame-Options SAMEORIGIN;"
    echo "    add_header X-XSS-Protection \"1; mode=block\";"
    echo ""
    echo "    # 设置客户端最大请求体大小"
    echo "    client_max_body_size 50M;"
    echo ""
    echo "    # 日志配置（统一到/app/data/logs/nginx）"
    echo "    access_log /app/data/logs/nginx/access.log;"
    echo "    error_log /app/data/logs/nginx/error.log;"
else
    echo "    # HTTP配置"
fi)

    # API健康检查 - 优先级最高
    location = /api/health {
        proxy_pass http://${PANSOU_HOST}:${PANSOU_PORT}/api/health;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
        proxy_send_timeout 5s;
        proxy_buffering off;
    }

    # API搜索接口 - 优先级第二
    location = /api/search {
        proxy_pass http://${PANSOU_HOST}:${PANSOU_PORT}/api/search;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Referer \$http_referer;
        proxy_connect_timeout 15s;
        proxy_read_timeout 60s;
        proxy_send_timeout 15s;
        proxy_buffering off;
    }

    # QQPD插件请求 - 代理到Go后端
    location /qqpd/ {
        proxy_pass http://${PANSOU_HOST}:${PANSOU_PORT}/qqpd/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Referer \$http_referer;
        proxy_buffering off;
    }

    location /gying/ {
        proxy_pass http://${PANSOU_HOST}:${PANSOU_PORT}/gying/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Referer \$http_referer;
        proxy_buffering off;
    }

    location /weibo/ {
        proxy_pass http://${PANSOU_HOST}:${PANSOU_PORT}/weibo/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Referer \$http_referer;
        proxy_buffering off;
    }

    # 其他API请求 - 代理到Go后端
    location /api/ {
        proxy_pass http://${PANSOU_HOST}:${PANSOU_PORT}/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Referer \$http_referer;
        proxy_buffering off;
    }

    # 静态资源 - 启用缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        root /app/frontend/dist;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
        add_header X-Content-Type-Options nosniff;
    }

    # 前端应用 - SPA路由支持
    location / {
        root /app/frontend/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
        
        # 防止缓存HTML文件
        location ~* \.html$ {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }
    }
}
EOF

echo "✓ Nginx配置已生成"

# 后端进程启动函数
start_backend() {
    echo "========================================"
    echo "启动PanSou后端服务..."
    echo "========================================"
    cd /app
    
    # 将后端日志输出到统一的日志目录
    ./pansou > /app/data/logs/backend/pansou.log 2>&1 &
    BACKEND_PID=$!
    
    echo "✓ 后端服务已启动 (PID: $BACKEND_PID)"
    echo "✓ 日志文件: /app/data/logs/backend/pansou.log"
    
    return 0
}

# 后端进程监控函数（增强版）
monitor_backend() {
    local consecutive_failures=0
    local max_consecutive_failures=$HEALTH_CHECK_RETRIES
    
    echo "========================================"
    echo "后端监控进程已启动"
    echo "- 检查间隔: ${HEALTH_CHECK_INTERVAL}秒"
    echo "- 超时时间: ${HEALTH_CHECK_TIMEOUT}秒"
    echo "- 最大失败次数: ${max_consecutive_failures}次"
    echo "========================================"
    
    while true; do
        sleep ${HEALTH_CHECK_INTERVAL}
        
        # 检查进程是否存在
        if ! kill -0 $BACKEND_PID 2>/dev/null; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  警告: 后端进程已退出，准备重启..."
            consecutive_failures=$((consecutive_failures + 1))
            
            # 记录最后几行日志
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] 最后的日志输出:"
            tail -n 20 /app/data/logs/backend/pansou.log
            
            start_backend
            
            # 等待服务启动（最多30秒）
            for i in $(seq 1 30); do
                if curl -sf --max-time ${HEALTH_CHECK_TIMEOUT} http://${PANSOU_HOST}:${PANSOU_PORT}/api/health >/dev/null 2>&1; then
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ 后端服务重启成功"
                    consecutive_failures=0
                    break
                fi
                sleep 1
            done
            
        else
            # 进程存在，检查健康状态
            if ! curl -sf --max-time ${HEALTH_CHECK_TIMEOUT} http://${PANSOU_HOST}:${PANSOU_PORT}/api/health >/dev/null 2>&1; then
                consecutive_failures=$((consecutive_failures + 1))
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  警告: 健康检查失败 ($consecutive_failures/${max_consecutive_failures})"
                
                # 连续失败达到阈值才重启
                if [ $consecutive_failures -ge $max_consecutive_failures ]; then
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ 健康检查连续失败${consecutive_failures}次，强制重启后端服务..."
                    
                    # 记录最后几行日志
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 最后的日志输出:"
                    tail -n 20 /app/data/logs/backend/pansou.log
                    
                    # 强制结束进程
                    kill -9 $BACKEND_PID 2>/dev/null || true
                    sleep 2
                    
                    start_backend
                    
                    # 等待服务启动（最多30秒）
                    for i in $(seq 1 30); do
                        if curl -sf --max-time ${HEALTH_CHECK_TIMEOUT} http://${PANSOU_HOST}:${PANSOU_PORT}/api/health >/dev/null 2>&1; then
                            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ 后端服务重启成功"
                            consecutive_failures=0
                            break
                        fi
                        sleep 1
                    done
                fi
            else
                # 健康检查成功，重置失败计数
                if [ $consecutive_failures -gt 0 ]; then
                    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ 健康检查恢复正常"
                    consecutive_failures=0
                fi
            fi
        fi
    done
}

# 优雅关闭处理
cleanup() {
    echo ""
    echo "========================================"
    echo "接收到停止信号，正在优雅关闭服务..."
    echo "========================================"
    
    # 停止监控进程
    if [ ! -z "$MONITOR_PID" ]; then
        echo "✓ 停止监控进程 (PID: $MONITOR_PID)"
        kill $MONITOR_PID 2>/dev/null || true
    fi
    
    # 停止后端服务
    if [ ! -z "$BACKEND_PID" ]; then
        echo "✓ 停止后端服务 (PID: $BACKEND_PID)"
        kill -TERM $BACKEND_PID 2>/dev/null || true
        wait $BACKEND_PID 2>/dev/null || true
    fi
    
    # 停止nginx
    echo "✓ 停止Nginx服务"
    nginx -s quit 2>/dev/null || true
    
    echo "========================================"
    echo "所有服务已停止"
    echo "========================================"
    exit 0
}

# 注册信号处理
trap cleanup SIGTERM SIGINT SIGQUIT

# 启动后端服务
start_backend

# 等待后端服务启动（最多30秒）
echo "等待后端服务启动..."
for i in $(seq 1 30); do
    if curl -sf --max-time 5 http://${PANSOU_HOST}:${PANSOU_PORT}/api/health >/dev/null 2>&1; then
        echo "✓ 后端服务启动成功 (尝试次数: $i/30)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ 错误: 后端服务启动失败（超时30秒）"
        echo "最后的日志输出:"
        tail -n 50 /app/data/logs/backend/pansou.log
        exit 1
    fi
    echo "等待后端服务... ($i/30)"
    sleep 1
done

# 在后台启动监控进程
monitor_backend &
MONITOR_PID=$!
echo "✓ 后端监控进程已启动 (PID: $MONITOR_PID)"

# 测试nginx配置
echo "========================================"
echo "测试Nginx配置..."
nginx -t
echo "✓ Nginx配置测试通过"
echo "========================================"

# 启动nginx（前台运行）
echo "启动Nginx服务..."
exec nginx -g "daemon off;"
