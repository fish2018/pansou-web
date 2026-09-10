FROM nginx:alpine

# 安装必要的运行时依赖
# 分两步安装以规避ARM64+QEMU的post-install脚本兼容性问题
RUN apk add --no-cache ca-certificates tzdata curl && \
    apk add --no-cache bash --allow-untrusted 2>/dev/null || \
    (apk add --no-cache --force-broken-world bash || true)

# 设置时区
ENV TZ=Asia/Shanghai

# 设置默认环境变量
ENV PANSOU_PORT=8888
ENV PANSOU_HOST=127.0.0.1

# 数据目录统一配置（所有持久化数据都在/app/data下）
ENV CACHE_PATH=/app/data/cache
ENV LOG_PATH=/app/data/logs

# 默认插件配置
ENV ENABLED_PLUGINS=dyyjpro,duoduo,djgou,feikuai,gaoqing888,gying,hdmoli,haitunsou,hunhepan,ikantv,jutoushe,kkv,dy4k,libvio,lingjisp,lou1,melost,meitizy,miosou,nyaa,ouge,panlian,pansearch,qqpd,quark4k,quarksoo,quarktv,qupanshe,sousou,thepiratebay,ting77,wanou,weibo,xb6v,xiaokupan,xiaozhang,xiaoyu,yingso,yulinshufa,yunso,yunsou,zlxapp,zxzj,rrbt,quarkres,diduan,erxiao,huban,labi,muou,shandian,zhizhen,clxiong,cyg,jsnoteclub,duanjuw,dyyj,nsgame,cldi,clmao,susu,u3c3,5266ys,dygang,leso,btbtlb,kpkuang,aipan

# 默认Telegram频道配置
ENV CHANNELS=tgsearchers7,Aliyun_4K_Movies,yunpanx,yp123pan,yunpanxunlei,tianyifc,peccxinpd,gotopan,PanjClub,baicaoZY,MCPH02,MCPH03,bdwpzhpd,Q66Share,ucwpzy,shareAliyun,Quark_Movies,XiangxiuNBB,ucquark,xx123pan,yingshifenxiang123,zyfb123,Lsp115,taoxgzy,Channel_Shares_115,vip115hot,wp123zy,yunpan139,yunpan189,yunpanuc,yydf_hzl,leoziyuan,yoyokuakeduanju,TG654TG,QukanMovie,yeqingjie_GJG666,movielover8888_film3,Baidu_netdisk,D_wusun,FLMdongtianfudi,KaiPanshare,rjyxfx,PikPak_Share_Channel,newproductsourcing,QuarkFree,yunpanNB,kkdj001,xxzlzn,pxyunpanxunlei,jxwpzy,kuakedongman,xiangnikanj,solidsexydoll,guoman4K,zdqxm,kduanju,cilidianying,CBduanju,SharePanFilms,dzsgx,BooksRealm,douerpan,Netdisk_Movies,yunpanquark,ciliziyuanku,jzmm_123pan,wpan8,mqte5,regengguangya,regeng115,regeng123,yy80986098,pan_guangya,guangyapan_episode,guangya_hdhive,guangyapindao,quark_res,domgmingapk,dianying4k,tgbokee,ucshare,gokuapan,WFYSFX03,gimy100,gimy115iso,fcij5,xvth5,xuexiziliaobaibaoku,phzvip,jdbigdiscount,youxigs,zhoulanziyuan,seedhub_pro,jnjy_5,xxziliao,wpzyk,ruanjianfenxiang77,jpnd5,XunLeiPinDao,a123fxme,WPpindao,kuyupan,djya5,zh_vip,gdsharing,guangyaya2026,alyp_17362,baidyunpan,yunpans,rbzhwpzy

# 默认性能配置
ENV CACHE_ENABLED=true
ENV CACHE_TTL=60
ENV MAX_CONCURRENCY=200
ENV MAX_PAGES=30

# 健康检查配置
ENV HEALTH_CHECK_INTERVAL=30
ENV HEALTH_CHECK_TIMEOUT=10
ENV HEALTH_CHECK_RETRIES=3

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

# 创建健康检查脚本（直接在镜像中创建，避免依赖外部文件）
RUN cat > /app/healthcheck.sh << 'EOF'
#!/bin/bash
# 健康检查脚本 - 检查nginx和后端服务是否正常

# 环境变量默认值
PANSOU_HOST=${PANSOU_HOST:-127.0.0.1}
PANSOU_PORT=${PANSOU_PORT:-8888}
HEALTH_CHECK_TIMEOUT=${HEALTH_CHECK_TIMEOUT:-10}

# 检查nginx是否运行
if ! pgrep nginx >/dev/null 2>&1; then
    echo "❌ Nginx进程不存在"
    exit 1
fi

# 检查nginx是否响应（通过80端口）
if ! curl -sf --max-time ${HEALTH_CHECK_TIMEOUT} http://localhost/api/health >/dev/null 2>&1; then
    echo "❌ Nginx无法访问健康检查端点"
    exit 1
fi

# 检查后端服务是否响应
if ! curl -sf --max-time ${HEALTH_CHECK_TIMEOUT} http://${PANSOU_HOST}:${PANSOU_PORT}/api/health >/dev/null 2>&1; then
    echo "❌ 后端服务健康检查失败"
    exit 1
fi

# 所有检查通过
exit 0
EOF

RUN chmod +x /app/healthcheck.sh

# 创建必要的目录结构（统一在/app/data下）
RUN mkdir -p /app/data/cache \
             /app/data/logs/backend \
             /app/data/logs/nginx \
             /app/data/ssl

# 创建nginx配置目录
RUN mkdir -p /etc/nginx/conf.d

# 健康检查（检查nginx和后端）
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD /app/healthcheck.sh || exit 1

# 暴露端口
EXPOSE 80 443

# 设置卷挂载点（只挂载/app/data，所有数据都在这里）
VOLUME ["/app/data"]

# 设置启动命令
CMD ["/app/start.sh"]
