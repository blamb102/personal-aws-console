import {Component} from "@angular/core";
import {LoggedInCallback, UserLoginService, Callback} from "../../service/cognito.service";
import {EC2Service} from "../../service/ec2.service";
import {CFService} from "../../service/cloudflare.service";
import {Router} from "@angular/router";
import {environment} from "../../../environments/environment";


export class Instances {
    name: string;
    id: string;
    type: string;
    state: string;
    ip: string;
}

export class Volume {
    volumeId: string;
    state: string;
    availability: string;
    attachment: string;
}

declare var AWS: any;
@Component({
    selector: 'my-aws-console-app',
    templateUrl: './myinstances.html'
})
export class MyInstancesComponent implements LoggedInCallback {

    public instances: Array<Instances> = [];
    public volume: Volume = new Volume();
    public cognitoId: String;
    public liveInstances: Boolean = false;

    constructor(public router: Router, public userService: UserLoginService, public ec2: EC2Service, public cf: CFService) {
        this.volume.volumeId = environment.jupyterVolumeId;
        this.userService.isAuthenticated(this);
        console.log("In MyInstancesComponent");
    }

    isLoggedIn(message: string, isLoggedIn: boolean) {
        if (!isLoggedIn) {
            this.router.navigate(['/home/login']);
        } else {
            this.ec2.listInstances(new GetInstancesCallback(this));
            this.ec2.describeVolume(this.volume.volumeId, new DescribeVolumeCallback(this));
        }
    }

    onAction(instance: Instances) {
        if (instance.state=='stopped') {
            this.ec2.startInstance(instance.id, new StartInstanceCallback(this, instance));
        }
        if (instance.state=='running') {
            this.ec2.stopInstance(instance.id, new StopInstanceCallback(this, instance));
        }
    }

    onConnect() {
        var newWindow = window.open('http://jupyter.brianlambson.com');
    }

    onMoveVolume(instanceId: string) {
      if (this.volume.availability=='in-use') {
        this.ec2.detachVolume(this.volume.volumeId, new DetachVolumeCallback(this, instanceId));
      } else {
        this.ec2.attachVolume(this.volume.volumeId, instanceId, new VolumeAttachedCallback(this));
      }
    }

}

export class GetInstancesCallback implements Callback {

    constructor(public me: MyInstancesComponent) {}

    callback() {}

    callbackWithParam(result: any) {
        this.me.instances = [];
        this.me.liveInstances = false;
        for (let i = 0; i < result.length; i++) {
            for (let j = 0; j < result[i].Instances.length; j++){
                if (result[i].Instances[j].State.Name == 'terminated') { continue; }
                let instance = new Instances();
                instance.id = result[i].Instances[j].InstanceId;
                instance.type = result[i].Instances[j].InstanceType;
                instance.state = result[i].Instances[j].State.Name;
                if (instance.state != 'stopped') { this.me.liveInstances = true }
                instance.ip = result[i].Instances[j].PublicIpAddress;
                instance.name = 'no-name'
                for(let k = 0; k < result[i].Instances[j].Tags.length; k++) {
                  if (result[i].Instances[j].Tags[k].Key=='Name'){
                    instance.name = result[i].Instances[j].Tags[k].Value;
                  }
                }
                this.me.instances.push(instance);
            }
        }

    }
}

export class StartInstanceCallback implements Callback {

    constructor(public me: MyInstancesComponent, public instance: Instances) {}

    callback() {
        let irc = new InstanceRunningCallback(this.me, this.instance);
        let wfrc = new WaitForRunningCallback(this.me, this.instance, irc)
        this.me.ec2.checkIfRunning(this.instance.id, irc, wfrc);
        this.me.ec2.listInstances(new GetInstancesCallback(this.me));
    }

    callbackWithParam(result: any) {}
}

export class WaitForRunningCallback implements Callback {

    constructor(public me: MyInstancesComponent, public instance: Instances, public irc: InstanceRunningCallback) {}

    private sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async callback() {
        await this.sleep(2000);
        this.me.ec2.checkIfRunning(this.instance.id, this.irc, this);
    }

    callbackWithParam(result: any) {}
}

export class InstanceRunningCallback implements Callback {

    constructor(public me: MyInstancesComponent, public instance: Instances) {}

    callback() {
        this.me.cf.updateCnameRecord(this.instance.id);
        this.me.ec2.listInstances(new GetInstancesCallback(this.me));
    }

    callbackWithParam() {}
}

export class StopInstanceCallback implements Callback {

    constructor(public me: MyInstancesComponent, public instance: Instances) {}

    callback() {
      let isc = new InstanceStoppedCallback(this.me);
      let wfsc = new WaitForStoppedCallback(this.me, this.instance, isc)
      this.me.ec2.checkIfStopped(this.instance.id, isc, wfsc);
      this.me.ec2.listInstances(new GetInstancesCallback(this.me));
    }

    callbackWithParam(result: any) {}
}

export class WaitForStoppedCallback implements Callback {

    constructor(public me: MyInstancesComponent, public instance: Instances, public isc: InstanceStoppedCallback) {}

    private sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async callback() {
        await this.sleep(2000);
        this.me.ec2.checkIfStopped(this.instance.id, this.isc, this);
    }

    callbackWithParam(result: any) {}
}

export class InstanceStoppedCallback implements Callback {

    constructor(public me: MyInstancesComponent) {}

    callback() {
        this.me.cf.restoreDefaultCnameRecord();
        this.me.ec2.listInstances(new GetInstancesCallback(this.me));
    }

    callbackWithParam(result: any) {}
}

export class DescribeVolumeCallback implements Callback {

    constructor(public me: MyInstancesComponent) {}

    callback() {}

    callbackWithParam(result: any) {
        this.me.volume.attachment = result.InstanceId;
        this.me.volume.state = result.State;
        this.me.volume.availability = result.Availability;
    }
}

export class DetachVolumeCallback implements Callback {

    constructor(public me: MyInstancesComponent, public instanceId: string) {}

    callback() {
        let vdc = new VolumeDetachedCallback(this.me, this.instanceId);
        let wfdc = new WaitForDetachedCallback(this.me, vdc)
        this.me.ec2.checkIfDetached(this.me.volume.volumeId, vdc, wfdc);
        this.me.ec2.describeVolume(this.me.volume.volumeId, new DescribeVolumeCallback(this.me));
    }

    callbackWithParam(result: any) {}
}

export class WaitForDetachedCallback implements Callback {

    constructor(public me: MyInstancesComponent, public vdc: VolumeDetachedCallback) {}

    private sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async callback() {
        await this.sleep(2000);
        this.me.ec2.checkIfDetached(this.me.volume.volumeId , this.vdc, this);
    }

    callbackWithParam(result: any) {}
}

export class VolumeDetachedCallback implements Callback {

    constructor(public me: MyInstancesComponent, public instanceId: string) {}

    callback() {
        this.me.ec2.attachVolume(this.me.volume.volumeId, this.instanceId, new AttachVolumeCallback(this.me));
        this.me.ec2.describeVolume(this.me.volume.volumeId, new DescribeVolumeCallback(this.me));
    }

    callbackWithParam(result: any) {}
}

export class AttachVolumeCallback implements Callback {

    constructor(public me: MyInstancesComponent) {}

    callback() {
        let vac = new VolumeAttachedCallback(this.me);
        let wfac = new WaitForAttachedCallback(this.me, vac)
        this.me.ec2.checkIfAttached(this.me.volume.volumeId, vac, wfac);
        this.me.ec2.describeVolume(this.me.volume.volumeId, new DescribeVolumeCallback(this.me));
    }

    callbackWithParam(result: any) {}
}

export class WaitForAttachedCallback implements Callback {

    constructor(public me: MyInstancesComponent, public vac: VolumeAttachedCallback) {}

    private sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async callback() {
        await this.sleep(2000);
        this.me.ec2.checkIfAttached(this.me.volume.volumeId, this.vac, this);
    }

    callbackWithParam(result: any) {}
}

export class VolumeAttachedCallback implements Callback {

    constructor(public me: MyInstancesComponent) {}

    callback() {
        console.log('MyInstancesComponent: Volume Attached to Instance')
        this.me.ec2.describeVolume(this.me.volume.volumeId, new DescribeVolumeCallback(this.me))
    }

    callbackWithParam(result: any) {}
}
