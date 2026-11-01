# 真实 DWG 本地验证

验证日期：2026-11-01。

使用本机下载目录中的《标准结晶撬装图20261020.dwg》，只对工作区 output/cad-real-test/source.dwg 副本进行转换。源文件696,661字节，文件签名AC1032。测试前后以SHA-256核对原文件，结果未改变。没有修改云端业务附件，没有上传图纸到第三方服务。

## 验证路径与边界

使用单独安装在忽略目录 output/cad-real-tools 的 @mlightcad/libredwg-web 0.8.3 进行本地转换，输出4,228,190字节ASCII DXF。此工具没有加入BESTCRM运行依赖或发布资源；本地测试不替代云端转换验证。随后在云端以应用服务用户、ODA File Converter 27.9和同一份样本完成验证：输出4,326,024字节，耗时1102ms，中文图层及3250mm参考线验证通过，原文件哈希不变；输出ODA_CONVERTER_VERIFIED、CAD_CONVERTER_SETUP_VERIFIED，应用健康。云端网页接入仍由发布后配置脚本单独验证。

WebGL查看器实际渲染转换后的图纸，包含3个主要图框区域。检测到1175个顶层实体，7个含几何图层，单位为毫米。中文图层包括中心线、框架图、标注层、文字层、设备层、虚线层和图框层，修复编码后均能正常显示。浏览器未报告渲染警告或页面脚本异常；独立网络检查未发现外部请求。未据此宣称所有代理对象、字体、尺寸样式均与原生CAD完全等效。

## 实测尺寸

选取转换后保留的LINE实体2BF55，端点坐标：

- 起点：(257598.5623113725, 15592.25050956465)
- 终点：(257598.5623113725, 12342.25050956465)

坐标距离3250mm。桌面鼠标点选和手机横屏触摸点选均捕捉到对应端点，网页显示距离3250mm、水平0mm、垂直3250mm。该次测量与坐标计算结果一致。这里只验证这一条参考线，不能推导出所有对象和所有图纸的测量均准确。

## 发现并修复的问题

原DXF头同时存在AC1032与ANSI_936代码页。最初代码误用旧代码页读取UTF-8内容，造成中文图层乱码。现按DXF版本判断：AC1021（R2007）及以后使用UTF-8，旧版本使用声明的中文代码页。已增加新版UTF-8且残留ANSI声明、旧版GBK中文两种回归测试。

参考：Autodesk DXF官方说明的Storage of String Values部分：
https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-DXF/files/GUID-2553CF98-44F6-4828-82DD-FE3BC7448113.htm

## 验证材料

本地预览：http://127.0.0.1:49808/real

忽略目录 output/cad-real-test 中保留：source-info.json、conversion-report.json、real-validation.json、real-validation-phone.json、real-measured.png、real-measured-phone.png、final-tests.log。原始图纸及转换结果未加入Git。

19项CAD、测量、权限、原有Office预览测试通过。转换器已在云端验证；网页功能发布与配置须以部署日志为准。
