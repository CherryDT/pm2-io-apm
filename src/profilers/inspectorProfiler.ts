
import { ProfilerType } from '../features/profiling'
import Configuration from '../configuration'
import { ServiceManager } from '../serviceManager'
import { Transport } from '../services/transport'
import ActionService from '../services/actions'
import MiscUtils from '../utils/miscellaneous'
import { InspectorService } from '../services/inspector'
import * as inspector from 'inspector'
import * as Debug from 'debug'

class CurrentProfile {
  uuid: string
  startTime: number
  initiated: string
}

export default class InspectorProfiler implements ProfilerType {

  private profiler: InspectorService | undefined = undefined
  private actionService: ActionService | undefined
  private transport: Transport | undefined
  private currentProfile: CurrentProfile | null = null
  private logger: Function = Debug('axm:features:profiling:inspector')

  init () {
    this.profiler = ServiceManager.get('inspector')
    if (this.profiler === undefined) {
      Configuration.configureModule({
        heapdump: false,
        'feature.profiler.heap_snapshot': false,
        'feature.profiler.heap_sampling': false,
        'feature.profiler.cpu_js': false
      })
      return console.error(`Failed to require the profiler via inspector, disabling profiling ...`)
    }

    this.profiler.createSession()
    this.profiler.connect()
    this.profiler.post('Profiler.enable')
    this.profiler.post('HeapProfiler.enable')

    this.actionService = ServiceManager.get('actions')
    if (this.actionService === undefined) {
      return this.logger(`Fail to get action service`)
    }
    this.transport = ServiceManager.get('transport')
    if (this.transport === undefined) {
      return this.logger(`Fail to get transport service`)
    }

    Configuration.configureModule({
      heapdump: true,
      'feature.profiler.heapsnapshot': true,
      'feature.profiler.heapsampling': true,
      'feature.profiler.cpu_js': true
    })
    this.register()
  }

  register () {
    if (this.actionService === undefined) {
      return this.logger(`Fail to get action service`)
    }
    this.actionService.registerAction('km:heapdump', this.onHeapdump)
    this.actionService.registerAction('km:cpu:profiling:start', this.onCPUProfileStart)
    this.actionService.registerAction('km:cpu:profiling:stop', this.onCPUProfileStop)
    this.actionService.registerAction('km:heap:profiling:start', this.onHeapProfileStart)
    this.actionService.registerAction('km:heap:profiling:stop', this.onHeapProfileStop)
  }

  destroy () {
    this.logger('Inspector Profiler destroyed !')
    if (this.profiler === undefined) return
    this.profiler.post('Profiler.disable')
    this.profiler.post('HeapProfiler.disable')
  }

  private onHeapProfileStart (opts, cb) {
    if (typeof cb !== 'function') {
      cb = opts
      opts = {}
    }
    if (typeof opts !== 'object') {
      opts = {}
    }

    // not possible but thanks mr typescript
    if (this.profiler === undefined) {
      return cb({
        err: new Error('Profiler not available'),
        success: false
      })
    }

    if (this.currentProfile !== null) {
      return cb({
        err: new Error('A profiling is already running'),
        success: false
      })
    }
    this.currentProfile = new CurrentProfile()
    this.currentProfile.uuid = MiscUtils.generateUUID()
    this.currentProfile.startTime = Date.now()
    this.currentProfile.initiated = typeof opts.initiated === 'string'
      ? opts.initiated : 'manual'

     // run the callback to acknowledge that we received the action
    cb({ success: true, uuid: this.currentProfile })

    const defaultSamplingInterval = 16384
    this.profiler.post('HeapProfiler.startSampling', {
      samplingInterval: typeof opts.samplingInterval === 'number'
        ? opts.samplingInterval : defaultSamplingInterval
    })

    if (isNaN(parseInt(opts.timeout, 10))) return
    // if the duration is included, handle that ourselves
    const duration = parseInt(opts.timeout, 10)
    setTimeout(_ => {
      // it will send the profiling itself
      this.onHeapProfileStop(_ => {
        return
      })
    }, duration)
  }

  private onHeapProfileStop (cb) {
    if (this.currentProfile === null) {
      return cb({
        err: new Error('No profiling are already running'),
        success: false
      })
    }
    // not possible but thanks mr typescript
    if (this.profiler === undefined) {
      return cb({
        err: new Error('Profiler not available'),
        success: false
      })
    }

    // run the callback to acknowledge that we received the action
    cb({ success: true })

    this.profiler.post('HeapProfiler.stopSampling', ({ profile }: inspector.HeapProfiler.StopSamplingReturnType) => {
      // not possible but thanks mr typescript
      if (this.currentProfile === null) return
      if (this.transport === undefined) return

      const data = JSON.stringify(profile)

      this.transport.send('profilings', {
        uuid: this.currentProfile.uuid,
        duration: Date.now() - this.currentProfile.startTime,
        at: this.currentProfile.startTime,
        data,
        success: true,
        initiated: this.currentProfile.initiated,
        type: 'heapprofile',
        heapprofile: true
      })
      this.currentProfile = null
    })
  }

  private onCPUProfileStart (opts, cb) {
    if (typeof cb !== 'function') {
      cb = opts
      opts = {}
    }
    if (typeof opts !== 'object') {
      opts = {}
    }
    // not possible but thanks mr typescript
    if (this.profiler === undefined) {
      return cb({
        err: new Error('Profiler not available'),
        success: false
      })
    }

    if (this.currentProfile !== null) {
      return cb({
        err: new Error('A profiling is already running'),
        success: false
      })
    }
    this.currentProfile = new CurrentProfile()
    this.currentProfile.uuid = MiscUtils.generateUUID()
    this.currentProfile.startTime = Date.now()
    this.currentProfile.initiated = typeof opts.initiated === 'string'
      ? opts.initiated : 'manual'

     // run the callback to acknowledge that we received the action
    cb({ success: true, uuid: this.currentProfile })

    this.profiler.post('Profiler.start')

    if (isNaN(parseInt(opts.timeout, 10))) return
    // if the duration is included, handle that ourselves
    const duration = parseInt(opts.timeout, 10)
    setTimeout(_ => {
      // it will send the profiling itself
      this.onCPUProfileStop(_ => {
        return
      })
    }, duration)
  }

  private onCPUProfileStop (cb) {
    if (this.currentProfile === null) {
      return cb({
        err: new Error('No profiling are already running'),
        success: false
      })
    }
    // not possible but thanks mr typescript
    if (this.profiler === undefined) {
      return cb({
        err: new Error('Profiler not available'),
        success: false
      })
    }

    // run the callback to acknowledge that we received the action
    cb({ success: true })

    this.profiler.post('Profiler.stop', (res: any) => {
      // not possible but thanks mr typescript
      if (this.currentProfile === null) return
      if (this.transport === undefined) return

      const profile: inspector.Profiler.Profile = res.profile
      const data = JSON.stringify(profile)

      // send the profile to the transporter
      this.transport.send('profilings', {
        uuid: this.currentProfile.uuid,
        duration: Date.now() - this.currentProfile.startTime,
        at: this.currentProfile.startTime,
        data,
        success: true,
        initiated: this.currentProfile.initiated,
        type: 'cpuprofile',
        cpuprofile: true
      })
      this.currentProfile = null
    })
  }

  /**
   * Custom action implementation to make a heap snapshot
   */
  private onHeapdump (opts, cb) {
    if (typeof cb !== 'function') {
      cb = opts
      opts = {}
    }
    if (typeof opts !== 'object') {
      opts = {}
    }
    // not possible but thanks mr typescript
    if (this.profiler === undefined) {
      return cb({
        err: new Error('Profiler not available'),
        success: false
      })
    }

    // run the callback to acknowledge that we received the action
    cb({ success: true })

    // wait few ms to be sure we sended the ACK because the snapshot stop the world
    setTimeout(() => {
      const startTime = Date.now()
      this.takeSnapshot()
        .then(data => {
          // @ts-ignore thanks mr typescript but its not possible
          return this.transport.send('profilings', {
            data,
            at: startTime,
            initiated: typeof opts.initiated === 'string' ? opts.initiated : 'manual',
            duration: Date.now() - startTime,
            type: 'heapdump'
          })
        }).catch(err => {
          return cb({
            success: false,
            err: err
          })
        })
    }, 200)
  }

  takeSnapshot () {
    return new Promise((resolve, reject) => {
      // not possible but thanks mr typescript
      if (this.profiler === undefined) return reject(new Error(`Profiler not available`))

      const chunks: Array<string> = []
      const chunkHandler = (data: inspector.HeapProfiler.AddHeapSnapshotChunkEventDataType) => {
        chunks.push(data.chunk)
      }
      const progressHandler = (data: inspector.HeapProfiler.ReportHeapSnapshotProgressEventDataType) => {
        // not possible but thanks mr typescript
        if (this.profiler === undefined) return reject(new Error(`Profiler not available`))
        if (data.finished !== true) return

        // remove the listeners
        this.profiler.removeListener('HeapProfiler.addHeapSnapshotChunk', chunkHandler)
        this.profiler.removeListener('HeapProfiler.reportHeapSnapshotProgress', progressHandler)
        return resolve(chunks.join(''))
      }

      this.profiler.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler)
      this.profiler.on('HeapProfiler.reportHeapSnapshotProgress', progressHandler)
      this.profiler.post('HeapProfiler.takeHeapSnapshot')
    })
  }
}