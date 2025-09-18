FROM nginx:alpine

# 安装必要的运行时依赖
RUN apk add --no-cache ca-certificates tzdata curl

# 设置时区
ENV TZ=Asia/Shanghai

# 设置默认环境变量
ENV PANSOU_PORT=8888
ENV PANSOU_HOST=127.0.0.1

# 默认插件配置
ENV ENABLED_PLUGINS=labi,zhizhen,shandian,duoduo,muou,wanou

# 默认Telegram频道配置
ENV CHANNELS=tgsearchers3,Aliyun_4K_Movies,bdbdndn11,yunpanx,bsbdbfjfjff,yp123pan,sbsbsnsqq,yunpanxunlei,tianyifc,BaiduCloudDisk,txtyzy,peccxinpd,gotopan,PanjClub,kkxlzy,baicaoZY,MCPH01,bdwpzhpd,ysxb48,jdjdn1111,yggpan,MCPH086,zaihuayun,Q66Share,Oscar_4Kmovies,ucwpzy,shareAliyun,alyp_1,dianyingshare,Quark_Movies,XiangxiuNBB,ydypzyfx,ucquark,xx123pan,yingshifenxiang123,zyfb123,tyypzhpd,tianyirigeng,cloudtianyi,hdhhd21,Lsp115,oneonefivewpfx,qixingzhenren,taoxgzy,Channel_Shares_115,tyysypzypd,vip115hot,wp123zy,yunpan139,yunpan189,yunpanuc,yydf_hzl,leoziyuan,pikpakpan,Q_dongman,yoyokuakeduanju

# 默认性能配置
ENV CACHE_ENABLED=true
ENV CACHE_TTL=3600
ENV MAX_CONCURRENCY=200
ENV MAX_PAGES=30

# 创建应用目录
WORKDIR /app

# 获取架构信息
ARG TARGETARCH

# 复制对应架构的后端二进制文件
COPY pansou-${TARGETARCH} /app/pansou
RUN chmod +x /app/pansou

# 复制前端构建产物
COPY frontend-dist /app/frontend/dist/

# 复制启动脚本
COPY start.sh /app/
RUN chmod +x /app/start.sh

# 创建必要的目录
RUN mkdir -p /app/data /app/logs /var/log/nginx

# 创建nginx配置目录
RUN mkdir -p /etc/nginx/conf.d

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/api/health || exit 1

# 暴露端口
EXPOSE 80 443

# 设置卷挂载点
VOLUME ["/app/data", "/app/logs"]

# 设置启动命令
CMD ["/app/start.sh"]