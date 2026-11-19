// Sky themes: colours and lighting for the whole scene.
// Levels 1-10 are Day, 11-20 Sunset, 21-30 Night. Storm is used for custom
// levels (picked in the editor) and the daily challenge.

export const THEMES = {
  day: {
    name: 'Day',
    skyTop: '#3b7bd4', horizon: '#bfdcf2', sunDir: [-0.4, 0.55, -0.75], sunColor: '#fff0d6', sunGlow: 1,
    fog: [150, 700], hemiSky: '#dceeff', hemiGround: '#6b7488', hemi: 1.6, sun: '#fff3e0', sunLight: 2.2,
    clouds: '#ffffff', cloudOpacity: 0.95, exposure: 1.05, stars: 0,
  },
  sunset: {
    name: 'Sunset',
    skyTop: '#3a3f86', horizon: '#ffb079', sunDir: [0.55, 0.12, -0.83], sunColor: '#ffcf8a', sunGlow: 1.6,
    fog: [140, 650], hemiSky: '#ffd9b8', hemiGround: '#5a4a66', hemi: 1.3, sun: '#ffb070', sunLight: 2.4,
    clouds: '#ffd2b0', cloudOpacity: 0.95, exposure: 1.0, stars: 0.15,
  },
  night: {
    name: 'Night',
    skyTop: '#050a1c', horizon: '#1d2c52', sunDir: [-0.5, 0.45, -0.74], sunColor: '#dfe8ff', sunGlow: 0.5,
    fog: [120, 600], hemiSky: '#7f96d6', hemiGround: '#1b2036', hemi: 1.0, sun: '#b8c8ff', sunLight: 1.0,
    clouds: '#4a5a86', cloudOpacity: 0.85, exposure: 1.15, stars: 1,
  },
  storm: {
    name: 'Storm',
    skyTop: '#2b3240', horizon: '#6b7482', sunDir: [0.2, 0.6, -0.77], sunColor: '#c8ccd6', sunGlow: 0.12,
    fog: [90, 480], hemiSky: '#a9b2c2', hemiGround: '#3a3f4a', hemi: 1.25, sun: '#d0d6e2', sunLight: 1.1,
    clouds: '#5d6574', cloudOpacity: 1, exposure: 1.0, stars: 0, rain: true, lightning: true,
  },
};

export const THEME_IDS = Object.keys(THEMES);

export function themeForLevelIndex(index) {
  return index < 10 ? 'day' : index < 20 ? 'sunset' : 'night';
}
