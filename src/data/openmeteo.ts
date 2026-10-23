import type { WeatherHour } from '../sim/types';

export interface LiveWeather {
  hours: WeatherHour[];
  antecedentRainMm: number;
  timezone: string;
  fetchedAt: string;
  url: string;
}

/**
 * Hourly forecast from Open-Meteo (no API key, CORS enabled).
 * Includes the past 3 days so we can compute antecedent rain.
 */
export async function fetchWeather(lat: number, lon: number, horizonH: number): Promise<LiveWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=kmh&timezone=auto&past_days=3&forecast_days=4`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const j = await res.json();
  const h = j.hourly as Record<string, (number | string)[]>;
  const times = h.time as string[];
  // Current local hour at the location.
  const nowLocal = new Date(Date.now() + (j.utc_offset_seconds as number) * 1000);
  const key = nowLocal.toISOString().slice(0, 13) + ':00';
  let i0 = times.findIndex((t) => t >= key);
  if (i0 < 0) i0 = times.length - horizonH - 1;
  let antecedent = 0;
  for (let i = Math.max(0, i0 - 72); i < i0; i++) antecedent += Number(h.precipitation[i] ?? 0);
  const hours: WeatherHour[] = [];
  for (let t = 0; t <= horizonH && i0 + t < times.length; t++) {
    const i = i0 + t;
    hours.push({
      t,
      time: times[i],
      windKmh: Number(h.wind_speed_10m[i]),
      windFromDeg: Number(h.wind_direction_10m[i]),
      tempC: Number(h.temperature_2m[i]),
      rh: Number(h.relative_humidity_2m[i]),
      precipMm: Number(h.precipitation[i] ?? 0),
    });
  }
  return { hours, antecedentRainMm: Math.round(antecedent * 10) / 10, timezone: j.timezone, fetchedAt: new Date().toISOString(), url };
}

/**
 * Past hourly weather from Open-Meteo's historical forecast archive (no key), in UTC,
 * starting at the hour of `t0`, plus the 72 h of rain before it. Used by hindcasts so
 * the model sees the weather it would have been given at the time.
 */
export async function fetchWeatherAt(lat: number, lon: number, t0: string, horizonH: number): Promise<LiveWeather> {
  const start = new Date(Date.parse(t0) - 72 * 3.6e6).toISOString().slice(0, 10);
  const end = new Date(Date.parse(t0) + (horizonH + 1) * 3.6e6).toISOString().slice(0, 10);
  const url =
    `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=kmh&timezone=UTC&start_date=${start}&end_date=${end}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo archive HTTP ${res.status}`);
  const j = await res.json();
  const h = j.hourly as Record<string, (number | string)[]>;
  const times = h.time as string[];
  const key = new Date(Date.parse(t0)).toISOString().slice(0, 13) + ':00';
  const i0 = times.indexOf(key);
  if (i0 < 0) throw new Error(`No archived weather for ${key} UTC`);
  let antecedent = 0;
  for (let i = Math.max(0, i0 - 72); i < i0; i++) antecedent += Number(h.precipitation[i] ?? 0);
  const hours: WeatherHour[] = [];
  for (let t = 0; t <= horizonH && i0 + t < times.length; t++) {
    const i = i0 + t;
    if (h.wind_speed_10m[i] === null) break;
    hours.push({
      t,
      time: `${times[i]} UTC`,
      windKmh: Number(h.wind_speed_10m[i]),
      windFromDeg: Number(h.wind_direction_10m[i]),
      tempC: Number(h.temperature_2m[i]),
      rh: Number(h.relative_humidity_2m[i]),
      precipMm: Number(h.precipitation[i] ?? 0),
    });
  }
  return { hours, antecedentRainMm: Math.round(antecedent * 10) / 10, timezone: 'UTC', fetchedAt: new Date().toISOString(), url };
}
