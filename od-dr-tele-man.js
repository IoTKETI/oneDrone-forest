/**
 * Created by Wonseok Jung in KETI on 2024-02-27.
 */

require("moment-timezone");
const moment = require('moment');
moment.tz.setDefault("Asia/Seoul");
const {SerialPort} = require('serialport');
const mqtt = require("mqtt");
const {nanoid} = require("nanoid");

global.conf = require('./conf');

const {mavlink10, MAVLink10Processor} = require('./mavlibrary/mavlink1');
const {mavlink20, MAVLink20Processor} = require('./mavlibrary/mavlink2');

let mavPort = null;
let mavPortNum = '/dev/ttyAMA0';
let mavBaudrate = '115200';

let my_sortie_name = 'unknown';

let my_system_id = 8;

// dr broker
let dr_mqtt_client = null;
// od-dr-tele-relay.js
let sub_gcs_topic = '/Mobius/' + conf.drone_info.gcs + '/GCS_Data/' + conf.drone_info.drone + '/orig';
let pub_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/disarm/orig';

let pub_sortie_topic = '/od/tele/relay/man/sortie/orig';

init();

function init() {
    dr_mqtt_connect('127.0.0.1');

    mavPortOpening();
}

const MavLinkProtocolV1 = {
    NAME: 'MAV_V1',
    START_BYTE: 0xFE,
    PAYLOAD_OFFSET: 6,
    CHECKSUM_LENGTH: 2,
    SYS_ID: 254,
    COMP_ID: 1,
};

const MavLinkProtocolV2 = {
    NAME: 'MAV_V2',
    START_BYTE: 0xFD,
    PAYLOAD_OFFSET: 10,
    CHECKSUM_LENGTH: 2,
    SYS_ID: 254,
    COMP_ID: 1,
    IFLAG_SIGNED: 0x01
};

const KNOWN_PROTOCOLS_BY_STX = {
    [MavLinkProtocolV1.START_BYTE]: MavLinkProtocolV1,
    [MavLinkProtocolV2.START_BYTE]: MavLinkProtocolV2,
};

function findStartOfPacket(buffer) {
    const stxv1 = buffer.indexOf(MavLinkProtocolV1.START_BYTE);
    const stxv2 = buffer.indexOf(MavLinkProtocolV2.START_BYTE);

    if (stxv1 >= 0 && stxv2 >= 0) {
        // in the current buffer both STX v1 and v2 are found - get the first one
        if (stxv1 < stxv2) {
            return stxv1;
        }
        else {
            return stxv2;
        }
    }
    else if (stxv1 >= 0) {
        // in the current buffer STX v1 is found
        return stxv1;
    }
    else if (stxv2 >= 0) {
        // in the current buffer STX v2 is found
        return stxv2;
    }
    else {
        // no STX found
        return null;
    }
}

function getPacketProtocol(buffer) {
    return KNOWN_PROTOCOLS_BY_STX[buffer.readUInt8(0)] || null;
}

function readPacketLength(buffer, Protocol) {
    // check if the current buffer contains the entire message
    const payloadLength = buffer.readUInt8(1);
    return Protocol.PAYLOAD_OFFSET
        + payloadLength
        + Protocol.CHECKSUM_LENGTH
        + (isV2Signed(buffer) ? 13 : 0);
}

function isV2Signed(buffer) {
    const protocol = buffer.readUInt8(0);
    if (protocol === MavLinkProtocolV2.START_BYTE) {
        const flags = buffer.readUInt8(2);
        return !!(flags & MavLinkProtocolV2.IFLAG_SIGNED);
    }
}

function gcs_noti_handler(topic, message) {
    console.log('GCS - [' + moment().format('YYYY-MM-DD hh:mm:ssSSS') + '] ' + message.toString('hex'));

    let mavGCSData = message.toString('hex');

    if (mavPort) {
        if (mavPort.isOpen) {
            mavPort.write(message, () => {
                console.log('[GCS] write - ', mavGCSData);
            });
        }
    }
}

function dr_mqtt_connect(serverip) {
    if (!dr_mqtt_client) {
        let connectOptions = {
            host: serverip,
            port: conf.cse.mqttport,
            protocol: "mqtt",
            keepalive: 10,
            clientId: 'od-dr-tele-man_' + nanoid(15),
            protocolId: "MQTT",
            protocolVersion: 4,
            clean: true,
            reconnectPeriod: 2 * 1000,
            connectTimeout: 30 * 1000,
            queueQoSZero: false,
            rejectUnauthorized: false
        };

        dr_mqtt_client = mqtt.connect(connectOptions);

        dr_mqtt_client.on('connect', () => {
            console.log('dr_mqtt_client is connected to ( ' + serverip + ' )');

            if (sub_gcs_topic !== '') {
                dr_mqtt_client.subscribe(sub_gcs_topic, () => {
                    console.log('[dr_mqtt_client] sub_gcs_topic is subscribed: ' + sub_gcs_topic);
                });
            }
        });

        dr_mqtt_client.on('message', (topic, message) => {
            if (topic === sub_gcs_topic) {
                gcs_noti_handler(topic, message);
            }
        });

        dr_mqtt_client.on('error', (err) => {
            console.log('[dr_mqtt_client] (error) ' + err.message);
        });
    }
}

function send_request_data_stream_command(req_stream_id, req_message_rate, start_stop) {
    let btn_params = {};
    btn_params.target_system = my_system_id;
    btn_params.target_component = 1;
    btn_params.req_stream_id = req_stream_id;
    btn_params.req_message_rate = req_message_rate;
    btn_params.start_stop = start_stop;

    try {
        let msg = mavlinkGenerateMessage(255, 0xbe, mavlink.MAVLINK_MSG_ID_REQUEST_DATA_STREAM, btn_params);
        if (!msg) {
            console.log("[send_request_data_stream_command] mavlink message is null");
        }
        else {
            if (mavPort) {
                if (mavPort.isOpen) {
                    mavPort.write(msg);
                }
            }
        }
    }
    catch (ex) {
        console.log('[ERROR] ', ex);
    }
}

function mavlinkGenerateMessage(src_sys_id, src_comp_id, type, params) {
    let mavlinkParser;
    if (mavVersion === 'v1') {
        mavlinkParser = new MAVLink10Processor(null/*logger*/, src_sys_id, src_comp_id);
    }
    else if (mavVersion === 'v2') {
        mavlinkParser = new MAVLink20Processor(null/*logger*/, src_sys_id, src_comp_id);
    }
    let mavMsg = null;
    let genMsg = null;
    try {
        switch (type) {
            case mavlink.MAVLINK_MSG_ID_REQUEST_DATA_STREAM:
                mavMsg = new mavlink.messages.request_data_stream(
                    params.target_system,
                    params.target_component,
                    params.req_stream_id,
                    params.req_message_rate,
                    params.start_stop
                );
                break;
        }
    }
    catch (e) {
        console.log('MAVLINK EX:' + e);
    }

    if (mavMsg) {
        genMsg = Buffer.from(mavMsg.pack(mavlinkParser));
        //console.log('>>>>> MAVLINK OUTGOING MSG: ' + genMsg.toString('hex'));
    }

    return genMsg;
}

function mavPortOpening() {
    if (!mavPort) {
        mavPort = new SerialPort({
            path: mavPortNum,
            baudRate: parseInt(mavBaudrate, 10),
        });
        mavPort.on('open', mavPortOpen);
        mavPort.on('close', mavPortClose);
        mavPort.on('error', mavPortError);
        mavPort.on('data', mavPortData);
    }
    else {
        if (mavPort.isOpen) {
            mavPort.close();
            mavPort = null;
            setTimeout(mavPortOpening, 2000);
        }
        else {
            mavPort.open();
        }
    }
}

function mavPortOpen() {
    console.log('mavPort(' + mavPort.path + '), mavPort rate: ' + mavPort.baudRate + ' open.');
}

function mavPortClose() {
    console.log('mavPort closed.');

    setTimeout(mavPortOpening, 2000);
}

function mavPortError(error) {
    console.log('[mavPort error]: ' + error.message);

    setTimeout(mavPortOpening, 2000);
}

let mavBufFromDrone = Buffer.from([]);
let mavVersion = 'unknown';
let reqDataStream = false;
let mavPacket = null;
let mavlink = mavlink20;
let mav_t_id = null;

function mavPortData(data) {
    mavBufFromDrone = Buffer.concat([mavBufFromDrone, data]);

    while (Buffer.byteLength(mavBufFromDrone) > 0) {
        const offset = findStartOfPacket(mavBufFromDrone);
        if (offset === null) {
            break;
        }

        if (offset > 0) {
            mavBufFromDrone = mavBufFromDrone.slice(offset);
        }

        const Protocol = getPacketProtocol(mavBufFromDrone);

        if (mavBufFromDrone.length < Protocol.PAYLOAD_OFFSET + Protocol.CHECKSUM_LENGTH) {
            break;
        }

        const expectedBufferLength = readPacketLength(mavBufFromDrone, Protocol);
        if (mavBufFromDrone.length < expectedBufferLength) {
            break;
        }

        const mavBuffer = mavBufFromDrone.slice(0, expectedBufferLength);

        try {
            if (Protocol.NAME === 'MAV_V1') {
                mavVersion = 'v1';
                mavlink = mavlink10;
                const mavParser = new MAVLink10Processor(null/*logger*/, Protocol.SYS_ID, Protocol.COMP_ID);
                mavPacket = mavParser.decode(mavBuffer);
            }
            else if (Protocol.NAME === 'MAV_V2') {
                mavVersion = 'v2';
                mavlink = mavlink20;
                const mavParser = new MAVLink20Processor(null/*logger*/, Protocol.SYS_ID, Protocol.COMP_ID);
                mavPacket = mavParser.decode(mavBuffer);
            }
            // console.log(mavVersion, mavPacket._msgbuf.toString('hex'))

            if (dr_mqtt_client) {
                dr_mqtt_client.publish(pub_drone_topic, mavPacket._msgbuf);
            }

            setTimeout(parseMavFromDrone, 0, mavPacket);

            mavBufFromDrone = mavBufFromDrone.slice(expectedBufferLength);
        }
        catch (e) {
            console.log('[mavParse]', e.message, '\n', mavBufFromDrone.toString('hex'));
            mavBufFromDrone = mavBufFromDrone.slice(1);
        }
    }

    if (!reqDataStream) {
        mav_t_id = setTimeout(() => {
            setTimeout(send_request_data_stream_command, 1, mavlink.MAV_DATA_STREAM_RAW_SENSORS, 3, 1);
            setTimeout(send_request_data_stream_command, 3, mavlink.MAV_DATA_STREAM_EXTENDED_STATUS, 3, 1);
            setTimeout(send_request_data_stream_command, 5, mavlink.MAV_DATA_STREAM_RC_CHANNELS, 3, 1);
            setTimeout(send_request_data_stream_command, 7, mavlink.MAV_DATA_STREAM_POSITION, 3, 1);
            setTimeout(send_request_data_stream_command, 9, mavlink.MAV_DATA_STREAM_EXTRA1, 3, 1);
            setTimeout(send_request_data_stream_command, 11, mavlink.MAV_DATA_STREAM_EXTRA2, 3, 1);
            setTimeout(send_request_data_stream_command, 13, mavlink.MAV_DATA_STREAM_EXTRA3, 3, 1);
            console.log('========================================\n  Send request data stream command\n========================================')

            reqDataStream = true;
        }, 3 * 1000);
    }
    else {
        clearTimeout(mav_t_id);
        mav_t_id = null;
    }
}

let fc = {};
let flag_base_mode = 0;

function parseMavFromDrone(mavPacket) {
    try {
        // console.log(mavPacket);
        if (mavPacket._id === mavlink.MAVLINK_MSG_ID_HEARTBEAT) { // #00 : HEARTBEAT
            fc.heartbeat = {};
            fc.heartbeat.type = mavPacket.type;
            if (fc.heartbeat.type !== mavlink.MAV_TYPE_ADSB) {
                my_system_id = mavPacket._header.srcSystem;
                fc.heartbeat.autopilot = mavPacket.autopilot;
                fc.heartbeat.base_mode = mavPacket.base_mode;
                fc.heartbeat.custom_mode = mavPacket.custom_mode;
                fc.heartbeat.system_status = mavPacket.system_status;
                fc.heartbeat.mavlink_version = mavPacket.mavlink_version;

                let armStatus = (fc.heartbeat.base_mode & 0x80) === 0x80;

                if (my_sortie_name === 'unknown') {
                    if (armStatus) {
                        flag_base_mode++;
                        if (flag_base_mode === 3) {
                            my_sortie_name = 'arm';

                            pub_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';

                            dr_mqtt_client.publish(pub_sortie_topic, 'unknown-arm:' + fc.global_position_int.time_boot_ms.toString());
                        }
                    }
                    else {
                        flag_base_mode = 0;
                        my_sortie_name = 'disarm';

                        pub_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';

                        dr_mqtt_client.publish(pub_sortie_topic, 'unknown-disarm:0');
                    }
                }
                else if (my_sortie_name === 'disarm') {
                    if (armStatus) {
                        flag_base_mode++;
                        if (flag_base_mode === 3) {
                            my_sortie_name = 'arm';
                            my_sortie_name = moment().format('YYYY_MM_DD_T_HH_mm');

                            pub_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';

                            dr_mqtt_client.publish(pub_sortie_topic, 'disarm-arm:' + fc.global_position_int.time_boot_ms.toString());
                        }
                    }
                    else {
                        flag_base_mode = 0;
                        my_sortie_name = 'disarm';
                    }
                }
                else if (my_sortie_name === 'arm') {
                    if (armStatus) {
                        my_sortie_name = 'arm';
                    }
                    else {
                        flag_base_mode = 0;
                        my_sortie_name = 'disarm';

                        pub_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';

                        dr_mqtt_client.publish(pub_sortie_topic, 'arm-disarm:0');
                    }
                }
            }
        }
        else if (mavPacket._id === mavlink.MAVLINK_MSG_ID_GLOBAL_POSITION_INT) { // #33
            fc.global_position_int = {};
            fc.global_position_int.time_boot_ms = mavPacket.time_boot_ms;
            fc.global_position_int.lat = mavPacket.lat;
            fc.global_position_int.lon = mavPacket.lon;
            fc.global_position_int.alt = mavPacket.alt;
            fc.global_position_int.relative_alt = mavPacket.relative_alt;
            fc.global_position_int.vx = mavPacket.vx;
            fc.global_position_int.vy = mavPacket.vy;
            fc.global_position_int.vz = mavPacket.vz;
            fc.global_position_int.hdg = mavPacket.hdg;

            reqDataStream = true;
            clearTimeout(mav_t_id);
            mav_t_id = null;

        }
    }
    catch (e) {
        if (!e.toString().includes('RangeError')) {
            console.log('[parseMavFromDrone Error]', e);
        }
    }
}
