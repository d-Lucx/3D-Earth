# Terra Atlas — Interactive 3D Earth Telemetry Dashboard

Terra Atlas is an interactive 3D geospatial and planetary telemetry dashboard built with React, TypeScript, Tailwind CSS, and Three.js/WebGL. It combines a fully procedural 2K Earth rendering engine with real-time meteorological, seismic, geomagnetic, and orbital visualizations inside a single-viewport control workspace.

---

## Features

### 3D Planetary Engine & Atmospheric Rendering
- **Procedural 2K Surface Maps & 1K Scientific Overlays**: Generates equirectangular day albedo, night city lights, surface roughness, elevation bump, cloud cover, precipitation radar, thermal, CO₂, and tectonic stress textures directly on HTML5 Canvas—with zero external texture image dependencies.
- **High-Accuracy Vector Coastlines & Biomes**: Detailed continental polygons, peninsulas, archipelagos, inland lakes, mountain cordilleras, desert basins, and ocean bathymetry shelves with pixel-center equirectangular alignment.
- **Zoom-Responsive Atmospheric Bloom & Scattering**: Layered front-side Fresnel horizon haze, outer Rayleigh scattering halo, and GPU post-processing (`EffectComposer` + `UnrealBloomPass` + `OutputPass`) that subtly intensifies planetary limb depth during close-up orbital views, with automatic direct-render fallback on software WebGL.
- **Real-Time Solar Terminator**: Physically aligned UTC day/night cycle with warm twilight scattering and dynamically emerging night-side city lights.

### Real-Time & Historical Geophysical Layers
- **Precip & Clouds Overlay**: Fetches live and past-24-hour global cloud cover (%) and precipitation intensity (`mm/h`) across a 72-point synoptic grid plus 18 monitoring stations via the Open-Meteo API, dynamically modulating both the 3D drifting cloud layer and the surface precipitation radar map.
- **Real-Time Seismic Monitoring**: Connects to the USGS Earthquake Hazards GeoJSON feed to render magnitude-scaled, color-coded 3D epicenter beacons with animated shockwave rings. Hover any pin for immediate magnitude, severity, hypocenter depth, location, and timestamp details; click to fly directly to the epicenter.
- **Interactive 3D Magnetic Field Vector Layer**: Models Earth's tilted IGRF geomagnetic dipole axis (`80.8° N, 72.8° W`) and South Atlantic Anomaly with concentric L-shell field lines, 156 instanced 3D surface vector arrows aligned to true local inclination and declination, animated magnetic flux particles, auroral ovals, and a live hover vector probe displaying `|B|` (`µT`), inclination (`Inc`), and declination (`Dec`).
- **24-Hour Historical Time-Scrubber**: Toggle between **Live** telemetry and **24h History** in the bottom control dock to scrub hour-by-hour or replay the past 24 hours of global weather snapshots, trailing 24-hour seismic windows, station readings, and synchronized UTC solar illumination.

### Orbital Tracking, Ground Network & Global Search
- **6 Tracked Spacecraft**: Composite multi-part 3D orbital models (ISS, Sentinel-2A, Landsat 9, Hubble Space Telescope, Terra EOS AM-1, and GOES-18) moving along inclined orbital planes with live nadir orientation and sub-satellite coordinates.
- **18 Global Monitoring Stations**: Clickable climate, seismic, oceanic, and atmospheric observatories connected by animated great-circle telemetry arcs, complete with 24-hour sparkline charts and live weather metrics.
- **Global Location Search**: Search cities, landmarks, monitoring stations, satellites, or raw `lat, lon` coordinates in the top bar (powered by Open-Meteo geocoding + local catalog) to smoothly fly the camera to any point on Earth with a 3D focus pin and live local weather telemetry.

---

## Live Data Sources

All external telemetry integrations use public, keyless HTTPS endpoints with deterministic offline fallbacks so the dashboard remains functional in restricted or offline environments:

| Domain | Source | Refresh / Window |
| --- | --- | --- |
| **Global Cloud Cover & Precipitation** | [Open-Meteo Forecast API](https://open-meteo.com/) | Auto-refreshes every 10 min · Live + past 24h hourly archive |
| **Global Earthquakes** | [USGS Earthquake Hazards GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Auto-refreshes every 5 min · 48h archive for 24h historical slicing |
| **Location Geocoding** | [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | On-demand debounced search + local landmark/station/satellite index |

No API keys are required to run the application locally.

---

## Tech Stack

- **UI & State**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **3D Graphics**: Three.js (`WebGLRenderer`, `OrbitControls`, `RoomEnvironment`, `EffectComposer`, `UnrealBloomPass`, `InstancedMesh`, custom GLSL shaders via `onBeforeCompile` & `ShaderMaterial`)
- **Build & Tooling**: Vite 8

---

## Project Structure

```text
.
├── index.html                        # Entry HTML, fonts, and favicon links
├── public/
│   └── favicon.svg                   # Custom vector Terra Atlas browser icon
└── src/
    ├── App.tsx                       # Root state, telemetry polling, 24h timeline orchestration
    ├── main.tsx                      # React DOM bootstrap
    ├── index.css                     # Tailwind v4 theme & custom slider/scrollbar styling
    ├── components/
    │   ├── TopBar.tsx                # 3-zone header with camera presets & global location search
    │   ├── BottomControlDock.tsx     # Collapsible HUD dock, 24h time-scrubber & telemetry inspectors
    │   └── SparklineChart.tsx        # 24h trend sparkline component for monitoring stations
    ├── data/
    │   └── earthData.ts              # Coordinate projections, stations, satellites, arcs & layer specs
    ├── services/
    │   ├── weatherTelemetry.ts       # Open-Meteo 24h global weather timeline + synoptic fallback
    │   ├── seismicTelemetry.ts       # USGS 48h seismic archive, 24h window slicing & fallback
    │   └── locationSearch.ts         # Global city/landmark/coordinate geocoding & unified search
    └── three/
        ├── EarthSceneEngine.ts       # Core Three.js scene, shaders, bloom, raycasting & animation loop
        ├── earthTextures.ts          # 2K procedural Earth & 1K scientific overlay canvas generator
        ├── worldGeography.ts         # High-resolution continental coastlines, lakes, biomes & cities
        ├── magneticFieldBuilder.ts   # Interactive 3D IGRF dipole field lines, vectors & cursor probe
        └── satelliteBuilder.ts       # Composite multi-part 3D spacecraft meshes
```

---

## Getting Started

### Prerequisites
- Node.js 20+ (or Bun)

### Installation & Local Development

```bash
# Install dependencies
npm install

# Start the development server on http://localhost:3000
npm run dev
```

### Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the Vite dev server on port `3000` |
| `npm run build` | Builds the optimized production bundle into `dist/` |
| `npm run preview` | Serves the production build locally for preview |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`) |

---

## Controls & Shortcuts

- **Orbit / Zoom**: Left-drag to rotate the globe; scroll or pinch to zoom (`1.32`–`5.4` Earth radii).
- **Inspect Markers**: Hover over earthquakes, monitoring stations, or satellites for instant details; click to focus the camera and open the telemetry inspector.
- **Magnetic Vector Probe**: Enable **Magnetic Field** in **Data Layers** and move the cursor across the Earth's surface to inspect local magnetic field intensity, inclination, and declination in real time.
- **Keyboard Shortcuts**:
  - `H` — Collapse or expand the bottom control dock (Zen / full-viewport mode)
  - `Escape` — Clear the currently selected target or close search results

---

## License

MIT
