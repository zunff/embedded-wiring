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

/** A board pin row: `caps` mirrors the datasheet's restrictions. */
function boardPin(name, role, extra = {}) {
  return { name, role, ...extra }
}

const esp32DevkitPins = [
  boardPin('3V3', 'power', { volt: 3.3, maxVolt: 3.3, note: '板载 LDO 输出，约 600mA 上限' }),
  boardPin('5V', 'power', { volt: 5, maxVolt: 5, note: 'VBUS 或 5V 输入' }),
  boardPin('GND', 'ground'),
  boardPin('GND2', 'ground'),
  boardPin('EN', 'input', { caps: ['reset'], note: '复位，低有效' }),
  boardPin('GPIO0', 'bidir', { caps: ['strapping', 'adc2', 'boot'], note: 'BOOT 键；上电电平决定启动模式' }),
  boardPin('GPIO1', 'bidir', { caps: ['uart0'], note: 'UART0 TX，烧录/日志占用' }),
  boardPin('GPIO2', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: '启动时必须为低' }),
  boardPin('GPIO3', 'bidir', { caps: ['uart0'], note: 'UART0 RX，烧录/日志占用' }),
  boardPin('GPIO4', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('GPIO5', 'bidir', { caps: ['strapping'], note: '启动时输出 PWM，接低电平外设要小心' }),
  boardPin('GPIO12', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: 'MTDI；上电拉高会改 flash 电压' }),
  boardPin('GPIO13', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('GPIO14', 'bidir', { caps: ['adc2', 'touch'], note: '启动时输出 PWM' }),
  boardPin('GPIO15', 'bidir', { caps: ['strapping', 'adc2', 'touch'], note: '启动时必须为高' }),
  boardPin('GPIO16', 'bidir'),
  boardPin('GPIO17', 'bidir'),
  boardPin('GPIO18', 'bidir', { note: '默认 SPI SCK' }),
  boardPin('GPIO19', 'bidir', { note: '默认 SPI MISO' }),
  boardPin('GPIO21', 'bidir', { note: '默认 I2C SDA' }),
  boardPin('GPIO22', 'bidir', { note: '默认 I2C SCL' }),
  boardPin('GPIO23', 'bidir', { note: '默认 SPI MOSI' }),
  boardPin('GPIO25', 'bidir', { caps: ['dac', 'adc2'] }),
  boardPin('GPIO26', 'bidir', { caps: ['dac', 'adc2'] }),
  boardPin('GPIO27', 'bidir', { caps: ['adc2', 'touch'] }),
  boardPin('GPIO32', 'bidir', { caps: ['adc1', 'touch'] }),
  boardPin('GPIO33', 'bidir', { caps: ['adc1', 'touch'] }),
  boardPin('GPIO34', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
  boardPin('GPIO35', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
  boardPin('GPIO36', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
  boardPin('GPIO39', 'input', { caps: ['adc1', 'input-only'], note: '只能输入，无内部上拉' }),
]

/** Board templates: `kind: 'board'` parts get their pins drawn on the right edge. */
export const BOARDS = {
  'esp32-devkitc': {
    label: 'ESP32 DevKitC',
    logicVolt: 3.3,
    note: '3.3V 逻辑；5V 引脚只是 VBUS 直通',
    pins: esp32DevkitPins,
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

/** Copy a template into a project part, so later library edits cannot mutate it. */
export function partFromTemplate(model, id, label, at) {
  const template = templateOf(model)
  if (template === undefined) throw new Error(`未知的硬件型号：${model}。可用型号见 hardware_map 的 read 结果或 GET /embedded-wiring/library`)
  return {
    id,
    model,
    kind: template.kind,
    label: typeof label === 'string' && label.trim() !== '' ? label.trim() : template.label,
    at: Array.isArray(at) && at.length === 2 ? [Math.round(at[0]), Math.round(at[1])] : undefined,
    pins: template.pins.map(pin => ({ ...pin })),
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
