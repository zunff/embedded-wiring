/**
 * What the plugin knows about hardware before the user says anything: one board
 * pin table and a small module catalog. These are only templates — every part
 * and pin is copied into the project file when it is added, so editing the file
 * is always enough and a plugin update never rewrites a project behind its back.
 *
 * Pin roles drive validation:
 *   power    supplies a rail (has `volt`), counts as a driver on its net
 *   ground   belongs to a common ground
 *   input    consumes a signal
 *   output   drives a signal; two of them on one net is a conflict
 *   bidir    may drive or sense (MCU GPIO, I2C data)
 *   passive  two-terminal parts (LED, resistor, button)
 *
 * `caps` on a board pin records what the silicon cannot do; the validator turns
 * those into warnings instead of letting a plausible-looking diagram burn a pin.
 * @module @local/embedded-wiring/library
 */

/**
 * A board pin row. `side` is which edge of the card it sits on, and the array
 * order is the physical top-to-bottom order of that edge: a DevKitC really does
 * have 3V3/EN/GPIO36… down one side and 5V/GND/GPIO15… down the other, and a
 * diagram that draws them as one list is harder to compare with the board in
 * your hand.
 */
function boardPin(side, name, role, extra = {}) {
  return { name, role, side, ...extra }
}

/**
 * ESP32-DevKitC V4, 19 pins per header (Espressif J2/J3 tables). The six flash
 * pins (D0/D1/D2/D3/CMD/CLK = GPIO6–11) are broken out on this board, which is
 * why it is 38 pins and not the 30 of the common clones.
 */
const esp32DevkitPins = [
  // J2 (left)
  boardPin('left', '3V3', 'power', { volt: 3.3, maxVolt: 3.3, note: '板载 LDO 输出，约 600mA 上限' }),
  boardPin('left', 'EN', 'input', { caps: ['reset'], note: '复位（CHIP_PU），低有效' }),
  boardPin('left', 'GPIO36', 'input', { caps: ['adc1', 'input-only'], note: 'VP；只能输入，无内部上拉' }),
  boardPin('left', 'GPIO39', 'input', { caps: ['adc1', 'input-only'], note: 'VN；只能输入，无内部上拉' }),
  boardPin('left', 'GPIO34', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
  boardPin('left', 'GPIO35', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
  boardPin('left', 'GPIO32', 'bidir', { caps: ['adc1', 'touch'] }),
  boardPin('left', 'GPIO33', 'bidir', { caps: ['adc1', 'touch'] }),
  boardPin('left', 'GPIO25', 'bidir', { caps: ['dac', 'adc2'] }),
  boardPin('left', 'GPIO26', 'bidir', { caps: ['dac', 'adc2'] }),
  boardPin('left', 'GPIO27', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('left', 'GPIO14', 'bidir', { caps: ['adc2', 'touch'], note: 'MTMS；启动时输出 PWM' }),
  boardPin('left', 'GPIO12', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: 'MTDI；上电拉高会改 flash 电压' }),
  boardPin('left', 'GND', 'ground'),
  boardPin('left', 'GPIO13', 'bidir', { caps: ['adc2', 'touch'], note: 'MTCK' }),
  boardPin('left', 'GPIO9', 'bidir', { caps: ['reserved'], note: '丝印 D2；接内部 SPI flash，勿用' }),
  boardPin('left', 'GPIO10', 'bidir', { caps: ['reserved'], note: '丝印 D3；接内部 SPI flash，勿用' }),
  boardPin('left', 'GPIO11', 'bidir', { caps: ['reserved'], note: '丝印 CMD；接内部 SPI flash，勿用' }),
  boardPin('left', '5V', 'power', { volt: 5, maxVolt: 5, note: 'VBUS 或 5V 输入' }),
  // J3 (right)
  boardPin('right', 'GND2', 'ground'),
  boardPin('right', 'GPIO23', 'bidir', { note: '默认 SPI MOSI' }),
  boardPin('right', 'GPIO22', 'bidir', { note: '默认 I2C SCL' }),
  boardPin('right', 'TX', 'bidir', { caps: ['uart0'], note: 'GPIO1，UART0 TX，烧录/日志占用' }),
  boardPin('right', 'RX', 'bidir', { caps: ['uart0'], note: 'GPIO3，UART0 RX，烧录/日志占用' }),
  boardPin('right', 'GPIO21', 'bidir', { note: '默认 I2C SDA' }),
  boardPin('right', 'GND3', 'ground'),
  boardPin('right', 'GPIO19', 'bidir', { note: '默认 SPI MISO' }),
  boardPin('right', 'GPIO18', 'bidir', { note: '默认 SPI SCK' }),
  boardPin('right', 'GPIO5', 'bidir', { caps: ['strapping'], note: '启动时输出 PWM，接低电平外设要小心' }),
  boardPin('right', 'GPIO17', 'bidir', { note: 'WROVER 模组上被 PSRAM 占用' }),
  boardPin('right', 'GPIO16', 'bidir', { note: 'WROVER 模组上被 PSRAM 占用' }),
  boardPin('right', 'GPIO4', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('right', 'GPIO0', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: 'BOOT 键；启动配置脚' }),
  boardPin('right', 'GPIO2', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: '启动时必须为低' }),
  boardPin('right', 'GPIO15', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: 'MTDO；启动时必须为高' }),
  boardPin('right', 'GPIO8', 'bidir', { caps: ['reserved'], note: '丝印 D1；接内部 SPI flash，勿用' }),
  boardPin('right', 'GPIO7', 'bidir', { caps: ['reserved'], note: '丝印 D0；接内部 SPI flash，勿用' }),
  boardPin('right', 'GPIO6', 'bidir', { caps: ['reserved'], note: '丝印 CLK；接内部 SPI flash，勿用' }),
]

/**
 * The 30-pin DevKitC clone everyone actually buys: the six flash pins are not
 * broken out, so the two headers are 15 pins each.
 */
const esp32Devkit30Pins = [
  boardPin('left', '3V3', 'power', { volt: 3.3, maxVolt: 3.3, note: '板载 LDO 输出，约 600mA 上限' }),
  boardPin('left', 'EN', 'input', { caps: ['reset'], note: '复位，低有效' }),
  boardPin('left', 'GPIO36', 'input', { caps: ['adc1', 'input-only'], note: 'VP；只能输入，无内部上拉' }),
  boardPin('left', 'GPIO39', 'input', { caps: ['adc1', 'input-only'], note: 'VN；只能输入，无内部上拉' }),
  boardPin('left', 'GPIO34', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
  boardPin('left', 'GPIO35', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
  boardPin('left', 'GPIO32', 'bidir', { caps: ['adc1', 'touch'] }),
  boardPin('left', 'GPIO33', 'bidir', { caps: ['adc1', 'touch'] }),
  boardPin('left', 'GPIO25', 'bidir', { caps: ['dac', 'adc2'] }),
  boardPin('left', 'GPIO26', 'bidir', { caps: ['dac', 'adc2'] }),
  boardPin('left', 'GPIO27', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('left', 'GPIO14', 'bidir', { caps: ['adc2', 'touch'], note: '启动时输出 PWM' }),
  boardPin('left', 'GPIO12', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: 'MTDI；上电拉高会改 flash 电压' }),
  boardPin('left', 'GPIO13', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('left', 'GND', 'ground'),
  boardPin('right', '5V', 'power', { volt: 5, maxVolt: 5, note: 'VBUS 或 5V 输入' }),
  boardPin('right', 'GND2', 'ground'),
  boardPin('right', 'GPIO15', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: '启动时必须为高' }),
  boardPin('right', 'GPIO2', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: '启动时必须为低' }),
  boardPin('right', 'GPIO4', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('right', 'GPIO16', 'bidir', { note: 'WROVER 模组上被 PSRAM 占用' }),
  boardPin('right', 'GPIO17', 'bidir', { note: 'WROVER 模组上被 PSRAM 占用' }),
  boardPin('right', 'GPIO5', 'bidir', { caps: ['strapping'], note: '启动时输出 PWM，接低电平外设要小心' }),
  boardPin('right', 'GPIO18', 'bidir', { note: '默认 SPI SCK' }),
  boardPin('right', 'GPIO19', 'bidir', { note: '默认 SPI MISO' }),
  boardPin('right', 'GPIO21', 'bidir', { note: '默认 I2C SDA' }),
  boardPin('right', 'GPIO3', 'bidir', { caps: ['uart0'], note: 'UART0 RX，烧录/日志占用' }),
  boardPin('right', 'GPIO1', 'bidir', { caps: ['uart0'], note: 'UART0 TX，烧录/日志占用' }),
  boardPin('right', 'GPIO22', 'bidir', { note: '默认 I2C SCL' }),
  boardPin('right', 'GPIO23', 'bidir', { note: '默认 SPI MOSI' }),
]

/** ESP32-C3-DevKitC-02, 15 pins per header (Espressif J1/J3 tables). */
const c3Devkitc02Pins = [
  // J1
  boardPin('left', 'GND', 'ground'),
  boardPin('left', '3V3', 'power', { volt: 3.3, maxVolt: 3.3, note: '板载 LDO 输出' }),
  boardPin('left', '3V3_2', 'power', { volt: 3.3, maxVolt: 3.3, note: '同一路 3.3V' }),
  boardPin('left', 'RST', 'input', { caps: ['reset'], note: '复位（CHIP_PU），低有效' }),
  boardPin('left', 'GND2', 'ground'),
  boardPin('left', 'GPIO4', 'bidir', { caps: ['adc1', 'jtag'] }),
  boardPin('left', 'GPIO5', 'bidir', { caps: ['adc2', 'jtag'], note: 'ADC2；开 WiFi 时不可用' }),
  boardPin('left', 'GPIO6', 'bidir', { caps: ['jtag'] }),
  boardPin('left', 'GPIO7', 'bidir', { caps: ['jtag'] }),
  boardPin('left', 'GND3', 'ground'),
  boardPin('left', 'GPIO8', 'bidir', { caps: ['strapping'], note: '板载 RGB 灯；启动配置脚' }),
  boardPin('left', 'GPIO9', 'bidir', { caps: ['strapping'], note: 'BOOT；拉低进下载模式' }),
  boardPin('left', '5V', 'power', { volt: 5, maxVolt: 5, note: 'VBUS 或 5V 输入' }),
  boardPin('left', '5V_2', 'power', { volt: 5, maxVolt: 5 }),
  boardPin('left', 'GND4', 'ground'),
  // J3
  boardPin('right', 'GND5', 'ground'),
  boardPin('right', 'GPIO0', 'bidir', { caps: ['adc1'] }),
  boardPin('right', 'GPIO1', 'bidir', { caps: ['adc1'] }),
  boardPin('right', 'GPIO2', 'bidir', { caps: ['strapping', 'adc1'], note: '启动配置脚' }),
  boardPin('right', 'GPIO3', 'bidir', { caps: ['adc1'] }),
  boardPin('right', 'GND6', 'ground'),
  boardPin('right', 'GPIO10', 'bidir'),
  boardPin('right', 'GND7', 'ground'),
  boardPin('right', 'RX', 'bidir', { caps: ['uart0'], note: 'GPIO20，UART0 RX' }),
  boardPin('right', 'TX', 'bidir', { caps: ['uart0'], note: 'GPIO21，UART0 TX' }),
  boardPin('right', 'GND8', 'ground'),
  boardPin('right', 'GPIO18', 'bidir', { caps: ['usb'], note: 'USB D-' }),
  boardPin('right', 'GPIO19', 'bidir', { caps: ['usb'], note: 'USB D+' }),
  boardPin('right', 'GND9', 'ground'),
  boardPin('right', 'GND10', 'ground'),
]

/** ESP32-C3-DevKitM-1, 15 pins per header (Espressif J1/J3 tables). */
const c3Devkitm1Pins = [
  // J1
  boardPin('left', 'GND', 'ground'),
  boardPin('left', '3V3', 'power', { volt: 3.3, maxVolt: 3.3, note: '板载 LDO 输出' }),
  boardPin('left', '3V3_2', 'power', { volt: 3.3, maxVolt: 3.3, note: '同一路 3.3V' }),
  boardPin('left', 'GPIO2', 'bidir', { caps: ['strapping', 'adc1'], note: '启动配置脚' }),
  boardPin('left', 'GPIO3', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GND2', 'ground'),
  boardPin('left', 'RST', 'input', { caps: ['reset'], note: '复位（CHIP_PU），低有效' }),
  boardPin('left', 'GND3', 'ground'),
  boardPin('left', 'GPIO0', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO1', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO10', 'bidir'),
  boardPin('left', 'GND4', 'ground'),
  boardPin('left', '5V', 'power', { volt: 5, maxVolt: 5, note: 'VBUS 或 5V 输入' }),
  boardPin('left', '5V_2', 'power', { volt: 5, maxVolt: 5 }),
  boardPin('left', 'GND5', 'ground'),
  // J3
  boardPin('right', 'GND6', 'ground'),
  boardPin('right', 'TX', 'bidir', { caps: ['uart0'], note: 'GPIO21，UART0 TX' }),
  boardPin('right', 'RX', 'bidir', { caps: ['uart0'], note: 'GPIO20，UART0 RX' }),
  boardPin('right', 'GND7', 'ground'),
  boardPin('right', 'GPIO9', 'bidir', { caps: ['strapping'], note: 'BOOT；拉低进下载模式' }),
  boardPin('right', 'GPIO8', 'bidir', { caps: ['strapping'], note: '板载 RGB 灯；启动配置脚' }),
  boardPin('right', 'GND8', 'ground'),
  boardPin('right', 'GPIO7', 'bidir', { caps: ['jtag'] }),
  boardPin('right', 'GPIO6', 'bidir', { caps: ['jtag'] }),
  boardPin('right', 'GPIO5', 'bidir', { caps: ['adc2', 'jtag'], note: 'ADC2；开 WiFi 时不可用' }),
  boardPin('right', 'GPIO4', 'bidir', { caps: ['adc1', 'jtag'] }),
  boardPin('right', 'GND9', 'ground'),
  boardPin('right', 'GPIO18', 'bidir', { caps: ['usb'], note: 'USB D-' }),
  boardPin('right', 'GPIO19', 'bidir', { caps: ['usb'], note: 'USB D+' }),
  boardPin('right', 'GND10', 'ground'),
]

/** ESP32-C3 SuperMini: 16 pins, 8 per edge (silkscreen order). */
const c3SuperminiPins = [
  boardPin('left', '5V', 'power', { volt: 5, maxVolt: 5, note: 'USB 5V 或外部 5V 输入' }),
  boardPin('left', 'GND', 'ground'),
  boardPin('left', '3V3', 'power', { volt: 3.3, maxVolt: 3.3, note: '板载 LDO 输出，别超过 ~300mA' }),
  boardPin('left', 'GPIO4', 'bidir', { caps: ['adc1', 'jtag'] }),
  boardPin('left', 'GPIO3', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO2', 'bidir', { caps: ['strapping', 'adc1'], note: '启动配置脚' }),
  boardPin('left', 'GPIO1', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO0', 'bidir', { caps: ['adc1'] }),
  boardPin('right', 'GPIO5', 'bidir', { caps: ['adc2'], note: 'ADC2；开 WiFi 时不可用' }),
  boardPin('right', 'GPIO6', 'bidir', { caps: ['jtag'] }),
  boardPin('right', 'GPIO7', 'bidir', { caps: ['jtag'] }),
  boardPin('right', 'GPIO8', 'bidir', { caps: ['strapping'], note: '板载蓝灯；启动配置脚' }),
  boardPin('right', 'GPIO9', 'bidir', { caps: ['strapping'], note: 'BOOT 按钮' }),
  boardPin('right', 'GPIO10', 'bidir'),
  boardPin('right', 'GPIO20', 'bidir', { caps: ['uart0'], note: 'UART0 RX' }),
  boardPin('right', 'GPIO21', 'bidir', { caps: ['uart0'], note: 'UART0 TX' }),
]

/** ESP32-S3-DevKitC-1, 22 pins per header (Espressif J1/J3 tables, v1.1). */
const s3Devkitc1Pins = [
  // J1
  boardPin('left', '3V3', 'power', { volt: 3.3, maxVolt: 3.3, note: '板载 LDO 输出' }),
  boardPin('left', '3V3_2', 'power', { volt: 3.3, maxVolt: 3.3, note: '同一路 3.3V' }),
  boardPin('left', 'RST', 'input', { caps: ['reset'], note: '复位（EN），低有效' }),
  boardPin('left', 'GPIO4', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO5', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO6', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO7', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO15', 'bidir', { caps: ['adc2'] }),
  boardPin('left', 'GPIO16', 'bidir', { caps: ['adc2'] }),
  boardPin('left', 'GPIO17', 'bidir', { caps: ['adc2'] }),
  boardPin('left', 'GPIO18', 'bidir', { caps: ['adc2'] }),
  boardPin('left', 'GPIO8', 'bidir', { caps: ['adc1'], note: '默认 I2C SDA（Arduino）' }),
  boardPin('left', 'GPIO3', 'bidir', { caps: ['strapping'], note: '启动配置脚（JTAG）' }),
  boardPin('left', 'GPIO46', 'bidir', { caps: ['strapping'], note: '启动配置脚' }),
  boardPin('left', 'GPIO9', 'bidir', { caps: ['adc1'], note: '默认 I2C SCL（Arduino）' }),
  boardPin('left', 'GPIO10', 'bidir', { caps: ['adc1'] }),
  boardPin('left', 'GPIO11', 'bidir', { caps: ['adc2'] }),
  boardPin('left', 'GPIO12', 'bidir', { caps: ['adc2'] }),
  boardPin('left', 'GPIO13', 'bidir', { caps: ['adc2'] }),
  boardPin('left', 'GPIO14', 'bidir', { caps: ['adc2'] }),
  boardPin('left', '5V', 'power', { volt: 5, maxVolt: 5, note: 'VBUS 或 5V 输入' }),
  boardPin('left', 'GND', 'ground'),
  // J3
  boardPin('right', 'GND2', 'ground'),
  boardPin('right', 'TX', 'bidir', { caps: ['uart0'], note: 'GPIO43，UART0 TX' }),
  boardPin('right', 'RX', 'bidir', { caps: ['uart0'], note: 'GPIO44，UART0 RX' }),
  boardPin('right', 'GPIO1', 'bidir', { caps: ['adc1'] }),
  boardPin('right', 'GPIO2', 'bidir', { caps: ['adc1'] }),
  boardPin('right', 'GPIO42', 'bidir'),
  boardPin('right', 'GPIO41', 'bidir'),
  boardPin('right', 'GPIO40', 'bidir'),
  boardPin('right', 'GPIO39', 'bidir'),
  boardPin('right', 'GPIO38', 'bidir', { note: '板载 RGB 灯（v1.1）' }),
  boardPin('right', 'GPIO37', 'bidir', { caps: ['reserved'], note: 'octal flash/PSRAM 模组上被内部占用' }),
  boardPin('right', 'GPIO36', 'bidir', { caps: ['reserved'], note: 'octal flash/PSRAM 模组上被内部占用' }),
  boardPin('right', 'GPIO35', 'bidir', { caps: ['reserved'], note: 'octal flash/PSRAM 模组上被内部占用' }),
  boardPin('right', 'GPIO0', 'bidir', { caps: ['strapping'], note: 'BOOT 按钮；启动配置脚' }),
  boardPin('right', 'GPIO45', 'bidir', { caps: ['strapping'], note: '启动配置脚（VDD_SPI 电压）' }),
  boardPin('right', 'GPIO48', 'bidir', { note: '板载 RGB 灯（v1.0）' }),
  boardPin('right', 'GPIO47', 'bidir'),
  boardPin('right', 'GPIO21', 'bidir'),
  boardPin('right', 'GPIO20', 'bidir', { caps: ['usb'], note: 'USB D+；ADC2' }),
  boardPin('right', 'GPIO19', 'bidir', { caps: ['usb'], note: 'USB D-；ADC2' }),
  boardPin('right', 'GND3', 'ground'),
  boardPin('right', 'GND4', 'ground'),
]

/** Board templates: their pins carry `side`, so the card is drawn like the board. */
export const BOARDS = {
  'esp32-devkitc': {
    label: 'ESP32-DevKitC V4',
    logicVolt: 3.3,
    note: '3.3V 逻辑；38 脚，含 6 个接内部 flash 的脚（GPIO6–11，勿用）',
    pins: esp32DevkitPins,
  },
  'esp32-devkitc-30': {
    label: 'ESP32 DevKitC 30 脚',
    logicVolt: 3.3,
    note: '3.3V 逻辑；常见 30 脚兼容板，内部 flash 那 6 个脚没引出',
    pins: esp32Devkit30Pins,
  },
  'esp32-c3-devkitc-02': {
    label: 'ESP32-C3-DevKitC-02',
    logicVolt: 3.3,
    note: '3.3V 逻辑，C3 不耐 5V；GPIO11–17 内部接 flash，未引出',
    pins: c3Devkitc02Pins,
  },
  'esp32-c3-devkitm-1': {
    label: 'ESP32-C3-DevKitM-1',
    logicVolt: 3.3,
    note: '3.3V 逻辑，C3 不耐 5V；GPIO11–17 内部接 flash，未引出',
    pins: c3Devkitm1Pins,
  },
  'esp32-c3-supermini': {
    label: 'ESP32-C3 SuperMini',
    logicVolt: 3.3,
    note: '3.3V 逻辑；GPIO8 板载蓝灯、GPIO9 BOOT；不同厂家丝印可能不同，以实物为准',
    pins: c3SuperminiPins,
  },
  'esp32-s3-devkitc-1': {
    label: 'ESP32-S3-DevKitC-1',
    logicVolt: 3.3,
    note: '3.3V 逻辑；GPIO35–37 在 octal flash/PSRAM 模组上不可用；RGB 灯 v1.1=GPIO38、v1.0=GPIO48',
    pins: s3Devkitc1Pins,
  },
}

/** Module templates. `volt` on a power pin is what the module needs to run. */
export const PARTS = {
  dht22: {
    label: 'DHT22 温湿度',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 5, accepts: [3.3, 5] },
      { name: 'DATA', role: 'bidir', note: '需 4.7k 上拉到 VCC' },
      { name: 'GND', role: 'ground' },
    ],
    note: '3 脚/4 脚两种封装，拍照后要核对引脚顺序',
  },
  dht11: {
    label: 'DHT11 温湿度',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 5, accepts: [3.3, 5] },
      { name: 'DATA', role: 'bidir', note: '需 4.7k 上拉到 VCC' },
      { name: 'GND', role: 'ground' },
    ],
  },
  bme280: {
    label: 'BME280 气压温湿度',
    pins: [
      { name: 'VIN', role: 'power', volt: 3.3, maxVolt: 3.6, accepts: [3.3] },
      { name: 'GND', role: 'ground' },
      { name: 'SCL', role: 'bidir' },
      { name: 'SDA', role: 'bidir' },
    ],
    note: 'I2C 地址 0x76 或 0x77',
  },
  mpu6050: {
    label: 'MPU6050 六轴',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 5, accepts: [3.3, 5] },
      { name: 'GND', role: 'ground' },
      { name: 'SCL', role: 'bidir' },
      { name: 'SDA', role: 'bidir' },
    ],
    note: 'I2C 地址 0x68',
  },
  ssd1306: {
    label: 'SSD1306 OLED',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 3.6, accepts: [3.3] },
      { name: 'GND', role: 'ground' },
      { name: 'SCL', role: 'bidir' },
      { name: 'SDA', role: 'bidir' },
    ],
    note: 'I2C 地址 0x3C',
  },
  bh1750: {
    label: 'BH1750 光照',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 3.6, accepts: [3.3] },
      { name: 'GND', role: 'ground' },
      { name: 'SCL', role: 'bidir' },
      { name: 'SDA', role: 'bidir' },
    ],
    note: 'I2C 地址 0x23',
  },
  hcsr04: {
    label: 'HC-SR04 超声',
    pins: [
      { name: 'VCC', role: 'power', volt: 5, maxVolt: 5, accepts: [5] },
      { name: 'TRIG', role: 'input' },
      { name: 'ECHO', role: 'output', maxVolt: 5, note: '5V 输出，直接接 3.3V GPIO 需要分压' },
      { name: 'GND', role: 'ground' },
    ],
    note: '经典 5V ECHO 电平问题',
  },
  sg90: {
    label: 'SG90 舵机',
    pins: [
      { name: 'V+', role: 'power', volt: 5, maxVolt: 6, accepts: [5], note: '堵转电流可达 700mA，别用板载 3V3' },
      { name: 'GND', role: 'ground' },
      { name: 'PWM', role: 'input' },
    ],
    note: '建议外部 5V 供电，与主控共地',
  },
  relay: {
    label: '继电器模块',
    pins: [
      { name: 'VCC', role: 'power', volt: 5, maxVolt: 5, accepts: [5] },
      { name: 'GND', role: 'ground' },
      { name: 'IN', role: 'input' },
    ],
    note: '多为低电平触发',
  },
  neopixel: {
    label: 'WS2812 灯带',
    pins: [
      { name: '5V', role: 'power', volt: 5, maxVolt: 5, accepts: [5], note: '满载电流大，务必外部供电' },
      { name: 'GND', role: 'ground' },
      { name: 'DIN', role: 'input' },
    ],
    note: '3.3V 数据电平可能不达 VIH，必要时加电平转换',
  },
  sdcard: {
    label: 'MicroSD (SPI)',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 3.6, accepts: [3.3] },
      { name: 'GND', role: 'ground' },
      { name: 'SCK', role: 'input' },
      { name: 'MOSI', role: 'input' },
      { name: 'MISO', role: 'output' },
      { name: 'CS', role: 'input' },
    ],
  },
  led: {
    label: 'LED + 电阻',
    pins: [
      { name: 'A', role: 'passive', note: '串 220Ω–1k' },
      { name: 'K', role: 'passive' },
    ],
  },
  button: {
    label: '轻触按键',
    pins: [
      { name: 'P1', role: 'passive' },
      { name: 'P2', role: 'passive' },
    ],
    note: '需要上拉或下拉',
  },
  potentiometer: {
    label: '电位器',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 3.6, accepts: [3.3] },
      { name: 'OUT', role: 'output' },
      { name: 'GND', role: 'ground' },
    ],
  },
  buzzer: {
    label: '有源蜂鸣器',
    pins: [
      { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 5, accepts: [3.3, 5] },
      { name: 'GND', role: 'ground' },
      { name: 'I/O', role: 'input' },
    ],
  },
}

/** Every template the page's palette and the agent's `add_part` may name. */
export function templateOf(model) {
  if (typeof model !== 'string') return undefined
  if (BOARDS[model] !== undefined) {
    return { kind: 'board', label: BOARDS[model].label, pins: BOARDS[model].pins, note: BOARDS[model].note }
  }
  if (PARTS[model] !== undefined) {
    return { kind: 'module', label: PARTS[model].label, pins: PARTS[model].pins, note: PARTS[model].note }
  }
  return undefined
}

/**
 * Copy a template into a project part, so later library edits cannot mutate it.
 * Board pins keep the template's edge; a module's pins sit on one edge unless
 * its template says otherwise.
 */
export function partFromTemplate(model, id, label, at) {
  const template = templateOf(model)
  if (template === undefined) throw new Error(`未知的硬件型号：${model}。可用型号见 hardware_map 的 read 结果或 GET /embedded-wiring/library`)
  return {
    id,
    model,
    kind: template.kind,
    label: typeof label === 'string' && label.trim() !== '' ? label.trim() : template.label,
    at: Array.isArray(at) && at.length === 2 ? [Math.round(at[0]), Math.round(at[1])] : undefined,
    pins: template.pins.map(pin => ({ ...pin, side: pin.side ?? (template.kind === 'board' ? 'right' : 'left') })),
    ...template.note !== undefined ? { note: template.note } : {},
  }
}

/** Palette payload for the page and for `add_part` discovery. */
export function catalog() {
  return {
    boards: Object.entries(BOARDS).map(([model, board]) => ({ model, label: board.label, note: board.note, pins: board.pins.length })),
    parts: Object.entries(PARTS).map(([model, part]) => ({ model, label: part.label, note: part.note, pins: part.pins.length })),
  }
}
