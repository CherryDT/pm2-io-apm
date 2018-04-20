import Transport from './utils/transport'
import MetricsService from './services/metrics'


const services: {
  transport: Transport;
  metricsMap: Map<string, any>
} = {
  transport: new Transport(),
  metricsMap: new Map()
}

if (require('semver').satisfies(process.version, '>= 8.0.0')) {
  services['inspector'] = require('./services/inspector')
}

export class ServiceManager {

  public static get (type: string) {
    return services[type]
  }

  public static set (type: string, service) {
    services[type] = service
  }
}