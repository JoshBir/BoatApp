param(
  [string]$subscriptionId = '',
  [string]$resourceGroup = 'boat-rg',
  [string]$location = 'westeurope',
  [string]$appName = 'boat-app-unique-name',
  [string]$planName = 'boat-app-plan',
  [string]$buildDir = 'dist'
)

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Write-Error "Azure CLI not found. Install from https://aka.ms/InstallAzureCli"
  exit 1
}

if ($subscriptionId -ne '') {
  az account set --subscription $subscriptionId
}

Write-Output "Building production bundle..."
npm ci
npm run build

Write-Output "Creating resource group (if missing): $resourceGroup"
az group create -n $resourceGroup -l $location | Out-Null

Write-Output "Creating App Service plan: $planName"
az appservice plan create -g $resourceGroup -n $planName --sku B1 --is-linux | Out-Null

Write-Output "Creating Web App: $appName"
az webapp create -g $resourceGroup -p $planName -n $appName --runtime "NODE|18-lts" | Out-Null

Write-Output "Zipping build directory: $buildDir"
$zipPath = Join-Path -Path (Get-Location) -ChildPath "site.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
Compress-Archive -Path "$buildDir\*" -DestinationPath $zipPath

Write-Output "Deploying via zip to web app..."
az webapp deployment source config-zip --resource-group $resourceGroup --name $appName --src $zipPath

Write-Output "Deployment complete. Browse to: https://$appName.azurewebsites.net"
