# 参考项目与素材来源

用户指定参考页：<https://www.quanxiaoha.com/column/10247.html>。

本次访问受到当前云环境 HTTPS 代理网络策略限制（CONNECT 403）。已把 `www.quanxiaoha.com` 加入环境配置草稿，尚未确认运行实例已应用该网络变更。没有取得页面中的仓库地址或源码，因此**当前代码为按用户功能要求编写的原生小程序实现，不能标为该开源项目的移植版**。参考项目接入仍待页面可读或收到准确仓库地址，再核查许可证、技术栈及可复用部分。

界面采用常见摄影社区的双列图片卡片、搜索分类、详情点赞评论结构，未使用小红书标识或品牌资源。

## 演示图片

所有示例仅用于未绑定云环境时的本机展示，不会自动写入正式社区。

| 本地文件 | 内容 / 作者 | 许可与来源 |
| --- | --- | --- |
| hero.jpg、sample-4.jpg | 蓝绿色山水视觉 | 本次 AI 生成；不代表黄水实拍 |
| sample-1.jpg | Coffee / Rachel Michetti | CC0，scikit-image sample data |
| sample-2.jpg | Chelsea the cat / Stefan van der Walt | CC0，scikit-image sample data |
| sample-3.jpg | DSCOVR Falcon 9 launch / SpaceX | 公有领域，scikit-image sample data |
| sample-5.jpg | Camera / Lav Varshney | CC0，scikit-image sample data；采用替换旧版权照片后的版本 |
| sample-6.jpg | Hubble eXtreme Deep Field / NASA | 公有领域，scikit-image sample data |

实际图片取自 [scikit-image v0.19.3 data](https://github.com/scikit-image/scikit-image/tree/v0.19.3/skimage/data)，逐项来源与许可参阅 [data fetchers](https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/_fetchers.py) 中同名函数文档。仅转换本地资源编码以减小小程序包体；不冒充真实用户发布的摄影作品。图标由本项目绘制。

云端依赖 `wx-server-sdk` 的版本与依赖由云函数 `package-lock.json` 固定，第三方组件按各自许可使用。首页音乐由管理员提供，应确认具备传播和使用权。
