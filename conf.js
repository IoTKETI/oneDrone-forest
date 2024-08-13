/**
 * Created by Wonseok Jung in KETI on 2022-11-04.
 */

const fs = require('fs');

let conf = {};
let cse = {};
let ae = {};
let acp = {};

conf.useprotocol = 'http'; // select one for 'http' or 'mqtt' or 'coap' or 'ws'

// build cse
let approval_host = {}
approval_host.ip = 'gcs.iotocean.org';

cse.host = approval_host.ip;
cse.port = '7579';
cse.name = 'Mobius';
cse.id = '/Mobius2';
cse.mqttport = '1883';
cse.wsport = '7577';

/* drone_info.json example include mission
    {
        "id": "Dione",
        "approval_gcs": "MUV",
        "host": "gcs.iotocean.org",
        "drone": "KETI_Drone",
        "gcs": "KETI_GCS",
        "type": "ardupilot",
        "system_id": 250
    }
*/

// build ae
let drone_info = {};
try {
    drone_info = JSON.parse(fs.readFileSync('./drone_info.json', 'utf8'));
}
catch (e) {
    console.log('can not find [ ./drone_info.json ] file');
    drone_info.id = "Dione";
    drone_info.approval_gcs = "MUV";
    drone_info.host = "gcs.iotocean.org";
    drone_info.drone = "KETI_Drone";
    drone_info.gcs = "KETI_GCS";
    drone_info.type = "ardupilot";
    drone_info.system_id = 250;

    fs.writeFileSync('./drone_info.json', JSON.stringify(drone_info, null, 4), 'utf8');
}
drone_info.gcs_ip = '192.168.' + drone_info.system_id + '.' + (parseInt(drone_info.system_id) - 1);

ae.approval_gcs = drone_info.approval_gcs;
ae.name = drone_info.id;

ae.id = 'S' + ae.name;

ae.parent = '/' + cse.name;
ae.appid = require('shortid').generate();
ae.port = '9727';
ae.bodytype = 'json'; // select 'json' or 'xml' or 'cbor'
ae.tas_mav_port = '3105';
ae.tas_sec_port = '3105';

// build acp: not complete
acp.parent = '/' + cse.name + '/' + ae.name;
acp.name = 'acp-' + ae.name;
acp.id = ae.id;


conf.usesecure = 'disable';

if (conf.usesecure === 'enable') {
    cse.mqttport = '8883';
}

conf.cse = cse;
conf.ae = ae;
conf.acp = acp;
conf.drone_info = drone_info;

module.exports = conf;
