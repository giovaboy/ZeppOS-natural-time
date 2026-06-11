import { createWidget, widget, align, text_style, prop, show_level, event } from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { Time, Weather } from '@zos/sensor'
import { localStorage } from '@zos/storage'

import {
  computeNaturalDate,
  formatDate,
  formatTime,
  formatLongitude,
  WEEKDAY_COLORS,
} from '../utils/natural-time'

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const { width: W, height: H } = getDeviceInfo()
const CX = W / 2
const CY = H / 2
const R = Math.min(W, H) / 2

const SUN_COLOR = 0xe5a00d // warm amber sun
const DIM = 0x666150
const TEXT_MAIN = 0xf2e9d8
const TEXT_DIM = 0x9a907c
const BG = 0x000000

// Rim ring: night base, daylight arc, golden sunrise/sunset segments.
const NIGHT_RIM = 0x232a3a
const DAY_RIM = 0x36c5d2
const GOLD_RIM = 0xf2c40f
const RIM_W = R * 0.055
const RIM_R = R - RIM_W / 2
const GOLD_HALF = 6 // degrees of rim on each side of sunrise/sunset

const NEEDLE_DOTS = 10
const TICK_COUNT = 24 // one mark per natural hour (15 degrees)

const BOTH = show_level.ONLY_NORMAL | show_level.ONAL_AOD

// Natural degrees -> screen angle (clockwise from top).
// 0 deg (midnight) sits at the bottom, 180 deg (noon) at the top, so the
// northern-hemisphere dial spins clockwise as the spec prescribes.
function ntToScreen(ntDeg) {
  return (ntDeg + 180) % 360
}

// Point on a circle for a screen angle measured clockwise from the top.
function pointAt(radius, screenDeg) {
  const rad = (screenDeg * Math.PI) / 180
  return {
    x: CX + radius * Math.sin(rad),
    y: CY - radius * Math.cos(rad),
  }
}

// ---------------------------------------------------------------------------
// Time source. Time.getTime() is the true UTC epoch; the JS Date object on
// ZeppOS runs on the local clock, so it is only used as a last resort.
// ---------------------------------------------------------------------------

const timeSensor = new Time()

function nowUtcMs() {
  try {
    const t = timeSensor.getTime()
    if (typeof t === 'number' && t > 0) return t
  } catch (e) {}
  return Date.now()
}

// Converts a local civil time-of-day (today) to a UTC epoch, deriving the
// timezone offset from the sensor's local fields vs its UTC epoch.
function localCivilToUtcMs(hour, minute) {
  const y = timeSensor.getFullYear()
  const mo = timeSensor.getMonth() - 1
  const d = timeSensor.getDate()
  const tzOffset =
    Date.UTC(y, mo, d, timeSensor.getHours(), timeSensor.getMinutes(), timeSensor.getSeconds()) -
    nowUtcMs()
  return Date.UTC(y, mo, d, hour, minute) - tzOffset
}

// ---------------------------------------------------------------------------
// Longitude acquisition: GPS once, cached; timezone meridian as fallback.
// ---------------------------------------------------------------------------

const LON_KEY = 'nt_longitude'

function saveLongitude(lon) {
  try {
    localStorage.setItem(LON_KEY, String(lon))
  } catch (e) {}
}

function loadLongitude() {
  try {
    const v = localStorage.getItem(LON_KEY, null)
    if (v !== null && v !== undefined) {
      const n = parseFloat(v)
      if (!isNaN(n)) return n
    }
  } catch (e) {}
  return null
}

// Meridian at the center of the device timezone, derived by comparing the
// sensor's local calendar fields with its UTC epoch (240000 ms per degree).
// Note: DST is baked into the device clock and cannot be detected, so in
// summer this overshoots by 15 degrees; it is only a first-boot fallback.
function timezoneLongitude() {
  try {
    const utc = timeSensor.getTime()
    const local = Date.UTC(
      timeSensor.getFullYear(),
      timeSensor.getMonth() - 1,
      timeSensor.getDate(),
      timeSensor.getHours(),
      timeSensor.getMinutes(),
      timeSensor.getSeconds(),
    )
    const lon = Math.round((local - utc) / 240000)
    if (lon >= -180 && lon <= 180) return lon
  } catch (e) {}
  return 0
}

// ---------------------------------------------------------------------------
// Watchface
// ---------------------------------------------------------------------------

WatchFace({
  onInit() {},

  build() {
    this.longitude = loadLongitude()
    if (this.longitude === null) this.longitude = timezoneLongitude()

    this.weather = new Weather()
    this.sunKey = null

    this.buildDial()
    this.render()
    this.updateSunArcs()

    timeSensor.onPerMinute(() => this.render())
    timeSensor.onPerDay(() => {
      this.sunKey = null
      this.updateSunArcs()
    })
  },

  // Static layer (built once) + dynamic widgets we later move/recolor.
  buildDial() {
    // Background.
    createWidget(widget.FILL_RECT, {
      x: 0, y: 0, w: W, h: H, radius: R, color: BG, show_level: BOTH,
    })

    // Rim ring: night base always visible; day/golden arcs sized once
    // sunrise/sunset arrive from the weather service (normal mode only).
    createWidget(widget.ARC_PROGRESS, {
      center_x: CX, center_y: CY, radius: RIM_R,
      start_angle: 0, end_angle: 360,
      color: NIGHT_RIM, line_width: RIM_W,
      level: 100, corner_flag: 0, show_level: show_level.ONLY_NORMAL,
    })
    this.dayArc = createWidget(widget.ARC_PROGRESS, {
      center_x: CX, center_y: CY, radius: RIM_R,
      start_angle: 0, end_angle: 0,
      color: DAY_RIM, line_width: RIM_W,
      level: 100, corner_flag: 0, show_level: show_level.ONLY_NORMAL,
    })
    this.riseArc = createWidget(widget.ARC_PROGRESS, {
      center_x: CX, center_y: CY, radius: RIM_R,
      start_angle: 0, end_angle: 0,
      color: GOLD_RIM, line_width: RIM_W,
      level: 100, corner_flag: 0, show_level: show_level.ONLY_NORMAL,
    })
    this.setArc = createWidget(widget.ARC_PROGRESS, {
      center_x: CX, center_y: CY, radius: RIM_R,
      start_angle: 0, end_angle: 0,
      color: GOLD_RIM, line_width: RIM_W,
      level: 100, corner_flag: 0, show_level: show_level.ONLY_NORMAL,
    })

    // Hour ticks (normal mode only, to keep AOD cheap).
    const tickR = R * 0.9
    for (let i = 0; i < TICK_COUNT; i++) {
      const ntDeg = (360 / TICK_COUNT) * i
      const major = ntDeg % 90 === 0 // midnight / 6h / noon / 18h
      const p = pointAt(tickR, ntToScreen(ntDeg))
      const rad = major ? R * 0.018 : R * 0.009
      createWidget(widget.CIRCLE, {
        center_x: p.x, center_y: p.y, radius: rad,
        color: major ? SUN_COLOR : DIM,
        show_level: show_level.ONLY_NORMAL,
      })
    }

    // Needle: a tapering trail of dots from hub to the sun (normal only).
    this.needle = []
    for (let i = 0; i < NEEDLE_DOTS; i++) {
      this.needle.push(
        createWidget(widget.CIRCLE, {
          center_x: CX, center_y: CY, radius: R * 0.012,
          color: SUN_COLOR, show_level: show_level.ONLY_NORMAL,
        }),
      )
    }

    // The sun marker itself (shown in AOD too).
    this.sun = createWidget(widget.CIRCLE, {
      center_x: CX, center_y: CY - R * 0.9, radius: R * 0.06,
      color: SUN_COLOR, show_level: BOTH,
    })

    // Central hub.
    createWidget(widget.CIRCLE, {
      center_x: CX, center_y: CY, radius: R * 0.03,
      color: SUN_COLOR, show_level: BOTH,
    })

    // Center readout: time degrees (big), date, longitude.
    this.timeText = createWidget(widget.TEXT, {
      x: 0, y: CY - R * 0.36, w: W, h: R * 0.34,
      text: '', color: TEXT_MAIN, text_size: Math.round(R * 0.30),
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, show_level: BOTH,
    })
    this.dateText = createWidget(widget.TEXT, {
      x: 0, y: CY + R * 0.06, w: W, h: R * 0.18,
      text: '', color: TEXT_MAIN, text_size: Math.round(R * 0.13),
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, show_level: BOTH,
    })
    this.lonText = createWidget(widget.TEXT, {
      x: 0, y: CY + R * 0.26, w: W, h: R * 0.14,
      text: '', color: TEXT_DIM, text_size: Math.round(R * 0.10),
      align_h: align.CENTER_H, align_v: align.CENTER_V,
      text_style: text_style.NONE, show_level: show_level.ONLY_NORMAL,
    })

    // Invisible tap zones on the longitude row: left = -1 degree,
    // right = +1 degree, center = reset to the timezone meridian.
    // No GPS: Geolocation.start() inside a watchface hard-crashes the
    // firmware (device reboot, observed on ZeppOS 3.x).
    const rowY = CY + R * 0.22
    const rowH = R * 0.22
    const mkTap = (x, w, fn) => {
      createWidget(widget.FILL_RECT, {
        x, y: rowY, w, h: rowH, color: 0x000000, alpha: 0,
        show_level: show_level.ONLY_NORMAL,
      }).addEventListener(event.CLICK_UP, fn)
    }
    mkTap(0, W / 3, () => this.nudgeLongitude(-1))
    mkTap(W / 3, W / 3, () => this.resetLongitude())
    mkTap((2 * W) / 3, W - (2 * W) / 3, () => this.nudgeLongitude(1))

    // Re-render on wake; weather data may have synced in the meantime.
    createWidget(widget.WIDGET_DELEGATE, {
      resume_call: () => {
        this.render()
        this.updateSunArcs()
      },
      pause_call: () => {},
    })
  },

  // Manual NT-zone adjustment, persisted.
  nudgeLongitude(delta) {
    let lon = Math.trunc(this.longitude) + delta
    if (lon > 180) lon = 180
    if (lon < -180) lon = -180
    this.longitude = lon
    saveLongitude(lon)
    this.render()
    this.updateSunArcs()
  },

  resetLongitude() {
    this.longitude = timezoneLongitude()
    saveLongitude(this.longitude)
    this.render()
    this.updateSunArcs()
  },

  // Paints the daylight arc and the golden sunrise/sunset segments on the
  // rim, converting today's civil sunrise/sunset to natural degrees.
  updateSunArcs() {
    let day = null
    try {
      // Proven on device as getForecast(); typings say getForecastWeather().
      const fc = this.weather.getForecast
        ? this.weather.getForecast()
        : this.weather.getForecastWeather()
      const td = fc && fc.tideData
      if (td && td.count) {
        const d0 = td.data[0]
        if (d0 && d0.sunrise && d0.sunset) day = d0
      }
    } catch (e) {}
    if (!day) return

    const key =
      day.sunrise.hour * 60 + day.sunrise.minute + '/' +
      (day.sunset.hour * 60 + day.sunset.minute) + '/' +
      Math.trunc(this.longitude)
    if (key === this.sunKey) return
    this.sunKey = key

    const riseNT = computeNaturalDate(
      localCivilToUtcMs(day.sunrise.hour, day.sunrise.minute), this.longitude).time
    const setNT = computeNaturalDate(
      localCivilToUtcMs(day.sunset.hour, day.sunset.minute), this.longitude).time

    const a1 = ntToScreen(riseNT)
    let a2 = ntToScreen(setNT)
    if (a2 <= a1) a2 += 360

    const arcProps = (start, end) => ({
      center_x: CX, center_y: CY, radius: RIM_R,
      start_angle: start, end_angle: end,
      line_width: RIM_W, level: 100, corner_flag: 0,
      show_level: show_level.ONLY_NORMAL,
    })
    this.dayArc.setProperty(prop.MORE,
      Object.assign({ color: DAY_RIM }, arcProps(a1, a2)))
    this.riseArc.setProperty(prop.MORE,
      Object.assign({ color: GOLD_RIM }, arcProps(a1 - GOLD_HALF, a1 + GOLD_HALF)))
    this.setArc.setProperty(prop.MORE,
      Object.assign({ color: GOLD_RIM }, arcProps(a2 - GOLD_HALF, a2 + GOLD_HALF)))
  },

  render() {
    const nd = computeNaturalDate(nowUtcMs(), this.longitude)
    const screen = ntToScreen(nd.time)
    const sunColor = WEEKDAY_COLORS[(nd.dayOfWeek - 1) % 7]

    // Sun position + weekday color.
    const sunR = R * 0.9
    const sp = pointAt(sunR, screen)
    this.sun.setProperty(prop.MORE, {
      center_x: sp.x, center_y: sp.y, radius: R * 0.06, color: sunColor,
    })

    // Needle trail: hub -> sun, tapering thickness.
    for (let i = 0; i < this.needle.length; i++) {
      const t = (i + 1) / (this.needle.length + 1)
      const p = pointAt(sunR * t, screen)
      this.needle[i].setProperty(prop.MORE, {
        center_x: p.x, center_y: p.y,
        radius: R * (0.012 + 0.018 * t),
        color: sunColor,
      })
    }

    // Texts.
    this.timeText.setProperty(prop.MORE, { text: formatTime(nd) })
    this.dateText.setProperty(prop.MORE, { text: formatDate(nd) })
    this.lonText.setProperty(prop.MORE, {
      text: formatLongitude(nd.effectiveLongitude),
    })
  },

  onDestroy() {},
})
