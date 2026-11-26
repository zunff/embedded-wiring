# 硬件接线（Embedded wiring）

给嵌入式开发用的接线网表：**一份 JSON 既是 Agent 读写的对象，也是页面上那张可拖拽的图**。左栏点「接线」打开全页画布。

## 用起来是什么样

板卡按实物画：ESP32 的引脚分成左右两列，左边 3V3/EN/GPIO36… 到底部 GND，右边 5V/GND/GPIO15… 到底部 GPIO23，跟手里那块板对照着看就行。

- 拖部件标题 = 挪位置（只改布局，不改语义）
- 从一个引脚圆点拖到另一个引脚 = 连一条网络
- 点线 = 改名 / 选类型（电源、地、信号、总线）/ 填协议（i2c、spi、uart）/ 填上拉（4.7k）
- 点部件标题（不拖）或点诊断里的「定位」= 看详情
- `Delete` 删掉选中的网络，`Esc` 取消当前操作，滚轮缩放
- 顶栏「诊断」显示校验结果，点「定位」跳到出问题的部件或网络

## 拍照加硬件

把模块的照片贴进聊天，模型认出型号和引脚后会用 `add_part` 建一个 `source: "photo"` 的部件：

- 部件标题上会出现 **照片?** 标记，诊断里有一条 `photo-unverified` 警告
- 点开部件详情能看到每个引脚的 role、电压、在哪一侧；核对过实物后点 **「标记引脚已核对」**，标记变 **照片✓**，警告消失
- 识别错了就改：让它用 `update_part` 重写 `pins`，或删掉重加

识别这一步不自动信任是有原因的：DHT22 有 3 脚/4 脚两种封装，SSD1306 有 4/6/7 脚，接反一次后面固件全废。

## 文件在哪

`<工作区>/hardware/wiring.json`。跟着项目走，可以提交进 git，改坏了直接回滚。页面顶栏可以选择不同工作区，A 项目的接线不会串到 B 项目。

```json
{
  "version": 1,
  "rev": 12,
  "meta": { "title": "我的接线", "board": "ESP32 DevKitC", "updatedAt": "..." },
  "parts": [
    { "id": "mcu", "model": "esp32-devkitc", "kind": "board", "label": "ESP32 DevKitC",
      "at": [80, 90], "pins": [{ "name": "GPIO4", "role": "bidir" }] }
  ],
  "nets": [
    { "id": "n3", "name": "DHT_DATA", "kind": "signal",
      "nodes": ["mcu:GPIO4", "dht:DATA"], "protocol": "1wire", "attrs": { "pullup": "4.7k" } }
  ],
  "pending": []
}
```

`pins` 在添加部件时从型号模板拷进项目，所以库更新不会偷偷改你的项目；照片/手册认出来的自定义硬件直接写 `pins` 数组即可。`at` 只是画布坐标，Agent 不需要碰。

## Agent 怎么用

工具 `hardware_map`，和页面走同一条写入路径、同一套校验：

| action | 作用 |
|---|---|
| `read` / `check` | 返回部件、网络、未连接引脚、校验结果，不写文件 |
| `add_part` | 加板卡/模块（`model`），或自定义 `pins` |
| `connect` / `disconnect` / `unlink` | 连线、删网络、把单个引脚从网络里摘掉 |
| `set_net` / `move` / `set_meta` | 改网络属性、摆位置、改项目标题 |
| `propose` | 把一批改动挂成「建议」，页面顶部出现「应用 / 忽略」 |
| `apply_pending` / `discard_pending` | 应用或忽略建议（你说「按这个改」时它才调） |

节点写法是 `部件id:引脚名`，例如 `mcu:GPIO4`、`dht:DATA`。ESP32 板卡模型是 `esp32-devkitc`；模块库有 dht22、dht11、bme280、mpu6050、ssd1306、bh1750、hcsr04、sg90、relay、neopixel、sdcard、led、button、potentiometer、buzzer。

## 校验什么（以及不校验什么）

会报错的：未共地、地分散在多个网络、5V 加到耐压 3.3V 的引脚、电源网络混接不同电压、同一网络两个输出对打、引脚同时出现在两张网络、引用了不存在的引脚。

会警告的：启动配置脚（GPIO0/2/5/12/15）、UART0 占用（GPIO1/3）、I2C 没标上拉、模块供电不足、只有一个引脚的空网络、照片识别的引脚还没核对。

**不校验**：电流预算、线径、EMI、器件真实封装、电平转换器的存在。它是连接关系的记录，不是电气审查；别把它当成「接了就一定不炸」。

## 边界

- 板卡库目前只有 ESP32 DevKitC 一份引脚表；换板子需要加一份 `lib/library.js` 条目（或者手动加带 `pins` 的板卡部件）。
- 照片识别是 Agent 那一侧的事：把照片贴进聊天，模型认出引脚后调 `add_part`。认错了会连错，所以识别结果建议走 `propose` 让你先确认。
- 页面和 Agent 同时改同一个文件时，用 `rev` 兜底：过期写入会提示「刚被别处改过」，不会静默覆盖。
