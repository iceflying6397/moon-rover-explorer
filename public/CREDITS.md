# SELENE · 资源来源

## SELENE 流线月球车

- 根据用户提供的七张设计参考图，在 Blender 5.2.1 中制作。
- 包含白色车身、太阳能顶板、四轮悬挂与镂空金属蜂窝车轮。
- GLB 约 1.76 MB、124,312 个绘制三角面；四个车轮共享几何数据。
- Blender 源文件与参考图保留在作者本地，不随公开仓库发布；网页使用 `/assets/rover/selene-rover.glb`。
- 图中尺寸与不可见结构按视觉需要估算，不是工程或动力学模型。

## 白色机甲六轮巡视器

- 根据用户确认的「02｜白色机甲」及多视角设计图，在 Blender 中制作。
- 平滑白色装甲、六个金属网面轮、展开太阳翼、双目相机与圆盘天线。
- Blender 原工程保留在作者本地，不随公开仓库发布；网页使用 `/assets/rover/white-mecha-rover.glb`。
- 网页版仅导出车辆，保留六个车轮枢轴与共享轮组网格；约 4.59 MB、216,728 个绘制三角面，无外部贴图。
- 属于玉兔二号启发的艺术化概念设计，尺寸和结构为视觉表达估算。

## VIPER 月球极地探测车

本场景使用 Project Chrono 的 VIPER 研究用工程模型，并依据 Viper.cpp 中的尺寸和装配变换组装。

- 模型来源：https://github.com/projectchrono/chrono/tree/main/data/robot/viper
- 装配参考：https://github.com/projectchrono/chrono/blob/main/src/chrono_models/robot/viper/Viper.cpp
- Copyright (c) 2016, Project Chrono Development Team
- 授权：BSD 3-Clause。完整许可见 /assets/rover/CHRONO-LICENSE.txt。
- 本地修改：转换为 GLB、添加表面 UV、调整 PBR 材质与细节、添加车轮动画。
- 模型约 181,725 个三角面；四个车轮保留独立转动枢轴。
- 本作品是独立的交互式视觉演示，地形、路线和遥测均为模拟；不是 NASA 官方产品或实际任务实时数据。

## 月壤表面

Poly Haven — Moon 01，CC0。

- https://polyhaven.com/a/moon_01
- https://polyhaven.com/license
- 在 Spaceport Rostock 实验室拍摄的月壤模拟材料。
- Dario Barresi（处理），Greg Zaal、Jenelle van Heerden、Rico Cilliers（摄影）。
- 使用本地 2K 漫反射、OpenGL 法线、粗糙度、环境遮蔽贴图。
- 地形网格、陨石坑、散落岩石、星空及车辙由程序生成，不是实测月球地形。

## 软件

Three.js（MIT）、React（MIT）、Vinext（MIT）、Base UI（MIT）、Lucide（ISC）、Tailwind CSS（MIT）。
模型和材质已包含在项目中。正常运行不请求第三方 CDN、在线模型服务或在线字体。

界面仍使用 shadcn 4.18.0 的本地样式，来源 `shadcn/dist/tailwind.css`，已保存为 `app/vendor/shadcn.css`。MIT 许可保留于项目 `licenses/shadcn-MIT.txt`；网站运行不依赖 shadcn CLI。
