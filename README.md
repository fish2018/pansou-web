# PanSou Web

🚀 镜像集成Pansou前后端，开箱即用。

[![Multi-Arch](https://img.shields.io/badge/arch-amd64%20%7C%20arm64-blue)](https://github.com/fish2018/pansou-web)

## 快速开始

### 一键启动

```bash
docker run -d --name pansou -p 80:80 ghcr.io/fish2018/pansou-web
```

访问：http://localhost

### Docker Compose（推荐）

```bash
# 下载配置文件
curl -o docker-compose.yml https://raw.githubusercontent.com/fish2018/pansou-web/main/docker-compose.yml

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

## 支持架构

镜像支持以下CPU架构：
- `linux/amd64` - Intel/AMD 64位处理器
- `linux/arm64` - ARM 64位处理器

Docker会自动选择适合您系统的架构版本。

## 环境变量

### 基础配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DOMAIN` | `localhost` | 访问域名 |
| `PANSOU_PORT` | `8888` | 后端端口 |
| `PANSOU_HOST` | `127.0.0.1` | 后端地址 |
| `ENABLED_PLUGINS` | `labi,zhizhen,shandian,duoduo,muou,wanou` | 启用的搜索插件（逗号分隔） |

> 🔌 **重要变更**: 从当前版本开始，必须通过 `ENABLED_PLUGINS` 显式指定要启用的插件，否则不会启用任何插件。

### Telegram频道配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `CHANNELS` | **已内置数十个频道，开箱即用，无需配置** | Telegram频道列表（逗号分隔） |

> 💡 **自定义频道**: 如需自定义，使用 `CHANNELS` 环境变量覆盖默认配置。

### 代理配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SOCKS5_PROXY` | - | SOCKS5代理地址 (如: `socks5://127.0.0.1:1080`) |
| `HTTP_PROXY` | - | HTTP代理地址 |
| `HTTPS_PROXY` | - | HTTPS代理地址 |

> 🌐 **代理说明**: 用于访问受限地区的Telegram站点，支持多种代理类型。

### 性能配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `CACHE_ENABLED` | `true` | 是否启用缓存 |
| `CACHE_TTL` | `3600` | 缓存过期时间（秒） |
| `MAX_CONCURRENCY` | `200` | 最大并发数 |
| `MAX_PAGES` | `30` | 最大搜索页数 |

> ⚡ **性能优化**: 镜像已内置优化配置，通常无需调整。

### 自定义配置示例

#### 基础配置
```bash
docker run -d \
  --name pansou \
  -p 80:80 \
  -e DOMAIN=yourdomain.com \
  -v pansou-data:/app/data \
  ghcr.io/fish2018/pansou-web
```

#### 完整配置（代理+自定义）
```bash
docker run -d \
  --name pansou \
  -p 80:80 \
  -e DOMAIN=yourdomain.com \
  -e SOCKS5_PROXY=socks5://127.0.0.1:1080 \
  -e CHANNELS=tgsearchers3,yunpanxunlei,BaiduCloudDisk \
  -e ENABLED_PLUGINS=labi,zhizhen,shandian,duoduo,muou,wanou \
  -v pansou-data:/app/data \
  ghcr.io/fish2018/pansou-web
```

> 🚀 **开箱即用**: 镜像已内置数十个频道和性能配置，仅需配置代理即可访问受限地区的Telegram站点。

## 数据持久化

```bash
# 数据目录挂载
-v /path/to/data:/app/data

# 日志目录挂载  
-v /path/to/logs:/app/logs

# SSL证书目录（可选）
-v /path/to/ssl:/app/data/ssl
```

## HTTPS 配置

将SSL证书放入数据目录的ssl子目录：

```
/app/data/ssl/
├── fullchain.pem    # 证书文件
└── privkey.pem      # 私钥文件
```

重启容器后自动启用HTTPS。

## 常用命令

```bash
# 查看运行状态
docker ps

# 查看日志
docker logs pansou

# 重启服务
docker restart pansou

# 停止服务
docker stop pansou

# 更新镜像
docker pull ghcr.io/fish2018/pansou-web && docker restart pansou
```
