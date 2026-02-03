Boat — Simulation Instructions

This page explains how to use the Scenario Simulator in the Boat app to plan device usage, estimate energy, and test system sustainability.

## Quick Start

- Run the app: `npm run dev` and open http://localhost:3000
- Open the Simulation panel (click the floating `Simulation` button).
- Add power components to your diagram (batteries, solar panels, alternator/DC-DC) or use custom loads in the simulator.
- Configure devices, then click `Run Scenario` to simulate.

## What the Simulator Uses

- Batteries: reads capacity (Ah) from battery or battery-bank components and sums them.
- Solar: sums wattage of `solar-panel` nodes and `solar-array` nodes (array = wattage × panelCount).
- Alternator / DC-DC: reads max output or charge rate (A) to model engine charging during engine hours.
- Loads: reads power draw from load nodes (W). If you don't have loads on the diagram, add custom loads in the Simulator.

Monthly/location data used:
- Average sun hours, irradiance, sunrise/sunset per month.
- Location multiplier (UK / Mediterranean / Northern / Tropical) alters solar yield.

Hourly calculations performed by the simulator:

1. Solar generation (bell curve peaking at solar noon, with system efficiency applied)
2. Load consumption based on hours/day, days/week and selected time periods
3. Alternator/DC-DC charging during configured engine hours
4. Battery state-of-charge (SOC) updated hourly from net power

## Adding and Configuring Devices (examples)

You can either add devices to the diagram (recommended for accurate wiring-related checks), or add `virtual` loads directly in the Simulator UI.

Example: Laptop + Starlink (your requested setup)

- Laptop: 60 W
  - Hours/day: 8
  - Days/week: 5
  - Usage periods: morning, afternoon (or whichever fits)

- Starlink: 100 W
  - Hours/day: 8
  - Days/week: 5
  - Usage periods: evening/night (if you use it overnight) or daytime

How to enter this:

1. Open Scenario Simulator
2. If loads are present on the diagram they appear automatically. Otherwise click **Add custom load** (button in the panel) to add a named load and set wattage.
3. For each device set `Hours per day = 8` and `Days per week = 5`.
4. Choose the time periods (icons) that best match when the device runs.
5. Choose location (affects solar yield) and whether to simulate the full year.
6. Click `Run Scenario`.

Note: Two 100 W panels => 200 W solar capacity (the simulator sums panel wattages).

## Interpreting Results

- `Min Battery` (SOC): lowest state-of-charge reached during the simulation.
- `Avg Battery` (SOC): average SOC over the simulated period.
- `Days Below 20%`: number of days SOC dropped under 20% (danger zone).
- `Monthly Breakdown` (if yearly run): quick view of which months were sustainable.
- `Recommendation` banner: suggestions such as adding solar, batteries, or increasing engine hours.

## Tips

- Use `Simulate full year` to find seasonal weaknesses (winter vs summer).
- Increase battery Ah or add panels if worst month drops under 20% SOC.
- If you rely on engine charging, set `Engine Hours/Day` to match realistic running patterns.

## File/Component mapping

- Simulator UI: `src/components/sidebar/SimulationPanel.tsx`
- Core simulation logic: `src/utils/simulation.ts`
- Component specs: `src/data/components.ts`

---
If you'd like, I can:
- Add an **Add custom load** button to the Simulator UI (if it's not already visible), or
- Pre-fill the Simulator with example devices (Laptop + Starlink) so you can run the scenario immediately.

## CI / Deployment

I added a GitHub Actions workflow that builds and deploys the app to Azure Static Web Apps on pushes to `main`:

- Workflow: `.github/workflows/azure-static-web-apps.yml`

Notes for Static Web Apps setup:
- The workflow expects the build output in `dist` (this repo's webpack `output.path` is `dist`).
- For Azure portal-created Static Web Apps, the portal provides a deployment token and will configure the GitHub workflow automatically. If you want to trigger deployments from this repo, add the secret `AZURE_STATIC_WEB_APPS_API_TOKEN` to GitHub (Settings → Secrets).

Local App Service deploy script:
- File: `scripts/deploy-appservice.ps1`
- Usage (PowerShell):
```
.\scripts\deploy-appservice.ps1 -subscriptionId '<your-subscription-id>' -resourceGroup 'my-rg' -location 'westeurope' -appName 'my-boat-app'
```

This script will:
- run `npm ci` and `npm run build`
- create a resource group and App Service plan (if missing)
- create a Linux Web App
- zip the `dist` folder and deploy via `az webapp deployment source config-zip`

