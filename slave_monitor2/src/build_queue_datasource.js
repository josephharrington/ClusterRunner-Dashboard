import * as d3 from 'd3';

import {conf} from './conf';
import * as FakeData from './fake_data';
import {ListRecording} from "./list_recording";
import {Log} from './log';
import {Network} from './network';


let queueRecording = window.queueRecording = new ListRecording('queueRecording.json', ['details']);


function BuildQueueDatasource(masterUrl)
{
    this._apiUrl = 'http://' + masterUrl + '/v1/queue';
    this._network = new Network();

    this.data = {};  // This will be an auto-updating map from queued build id to build info.
}
let cls = BuildQueueDatasource.prototype;

cls.start = function()
{
    let _this = this;
    function updateData() {

        function handleData(apiData) {
            Log.debug('BuildQueueDatasource.handleData()');
            let newData = apiData['queue'];

            // Remove all elements from the current data object
            let existingKeys = Object.keys(_this.data);
            for (let k = 0; k < existingKeys.length; k++) {
                delete _this.data[existingKeys[k]];
            }

            // Add all elements in newData to the existing data object
            for (let i = 0; i < newData.length; i++) {
                let build = newData[i];
                _this.data[build['id']] = build;
            }
            if (window.RECORD_MODE) {
                queueRecording.append(newData);
            }
        }

        if (window.DEBUG_MODE) {
            handleData({queue: FakeData.getFakeBuildQueue()});
        }
        else if (window.PLAYBACK_MODE) {
            handleData({queue: queueRecording.next()});
        }
        else {
            _this._network.get(_this._apiUrl, handleData);
        }
    }
    updateData();
    d3.interval(updateData, conf.updateFrequencyMs);
};


export default BuildQueueDatasource;
