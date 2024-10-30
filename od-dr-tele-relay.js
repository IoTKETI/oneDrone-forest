/**
 * Created by Wonseok Jung in KETI on 2024-02-27.
 */

require("moment-timezone");
const moment = require('moment');
moment.tz.setDefault("Asia/Seoul");
const fs = require('fs');
const {exec, spawn} = require('child_process');
const mqtt = require("mqtt");
const {nanoid} = require("nanoid");
const util = require("util");

global.conf = require('./conf');

let onem2m_client = require('./http_adn');

let my_sortie_name = 'unknown';

// dr broker
let dr_mqtt_client = null;
let sub_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/orig';
let pub_gcs_topic = '/Mobius/' + conf.drone_info.gcs + '/GCS_Data/' + conf.drone_info.drone + '/orig';
let sub_sortie_topic = '/od/tele/relay/man/sortie/orig';
let sub_msw_data_topic = [];
let pub_msw_control_topic = [];

// mobius broker
let mobius_mqtt_client = null;
let pub_lte_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';
let sub_lte_gcs_topic = '/Mobius/' + conf.drone_info.gcs + '/GCS_Data/' + conf.drone_info.drone + '/orig';
let pub_lte_msw_data_topic = [];
let sub_lte_msw_control_topic = [];

let noti_topic = '';

let MQTT_SUBSCRIPTION_ENABLE = 0;

let my_gcs_name = '';
let my_parent_cnt_name = '';
let my_cnt_name = '';
let my_command_parent_name = '';
let my_command_name = '';

let my_drone_type = 'ardupilot';
let my_system_id = 8;

let sh_state = 'rtvct';

const retry_interval = 2500;
const normal_interval = 100;

let return_count = 0;
let request_count = 0;

// for GCS
let GCSData = {};
let disconnected = true;

// for mission control
let MissionControlData = {};
let mct_id = null;
let mc_disconnected = true;
let mctrl_sequence = 0;

init();

function init() {
    set_resource();
}

function gcs_noti_handler(message) {
    console.log('GCS - [' + moment().format('YYYY-MM-DD hh:mm:ssSSS') + '] ' + message.toString('hex'));

    if (dr_mqtt_client) {
        dr_mqtt_client.publish(pub_gcs_topic, message);
    }
}

function set_resource() {
    let info;
    conf.cnt = [];
    conf.sub = [];

    if (conf.drone_info.hasOwnProperty('gcs')) {
        my_gcs_name = conf.drone_info.gcs;
    }
    else {
        my_gcs_name = 'KETI_MUV';
    }

    if (conf.drone_info.hasOwnProperty('host')) {
        conf.cse.host = conf.drone_info.host;
    }

    // set container for drone
    info = {};
    info.parent = '/Mobius/' + conf.drone_info.gcs;
    info.name = 'Drone_Data';
    conf.cnt.push(JSON.parse(JSON.stringify(info)));

    info = {};
    info.parent = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data';
    info.name = conf.drone_info.drone;
    conf.cnt.push(JSON.parse(JSON.stringify(info)));

    info.parent = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone;
    info.name = my_sortie_name;
    conf.cnt.push(JSON.parse(JSON.stringify(info)));

    my_parent_cnt_name = info.parent;
    my_cnt_name = my_parent_cnt_name + '/' + info.name;

    if (conf.drone_info.hasOwnProperty('type')) {
        my_drone_type = conf.drone_info.type;
    }
    else {
        my_drone_type = 'ardupilot';
    }

    if (conf.drone_info.hasOwnProperty('system_id')) {
        my_system_id = conf.drone_info.system_id;
    }
    else {
        my_system_id = 8;
    }

    // set container for GCS
    info = {};
    info.parent = '/Mobius/' + conf.drone_info.gcs;
    info.name = 'GCS_Data';
    conf.cnt.push(JSON.parse(JSON.stringify(info)));

    info = {};
    info.parent = '/Mobius/' + conf.drone_info.gcs + '/GCS_Data';
    info.name = conf.drone_info.drone;
    conf.cnt.push(JSON.parse(JSON.stringify(info)));

    my_command_parent_name = info.parent;
    my_command_name = my_command_parent_name + '/' + info.name;

    // set container for mission
    info = {};
    info.parent = '/Mobius/' + conf.drone_info.gcs;
    info.name = 'Mission_Data';
    conf.cnt.push(JSON.parse(JSON.stringify(info)));

    info = {};
    info.parent = '/Mobius/' + conf.drone_info.gcs + '/Mission_Data';
    info.name = conf.drone_info.drone;
    conf.cnt.push(JSON.parse(JSON.stringify(info)));

    if (conf.drone_info.hasOwnProperty('mission')) {
        for (let mission_name in conf.drone_info.mission) {
            if (conf.drone_info.mission.hasOwnProperty(mission_name)) {
                let arguments = [];

                info = {};
                info.parent = '/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone;
                info.name = mission_name;
                conf.cnt.push(JSON.parse(JSON.stringify(info)));

                let chk_cnt = 'container';
                if (conf.drone_info.mission[mission_name].hasOwnProperty(chk_cnt)) {
                    for (let idx in conf.drone_info.mission[mission_name][chk_cnt]) {
                        if (conf.drone_info.mission[mission_name][chk_cnt].hasOwnProperty(idx)) {
                            arguments.push(conf.drone_info.mission[mission_name][chk_cnt][idx]);

                            let container_name = conf.drone_info.mission[mission_name][chk_cnt][idx].split(':')[0];
                            info = {};
                            info.parent = '/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name;
                            info.name = container_name;
                            conf.cnt.push(JSON.parse(JSON.stringify(info)));

                            sub_msw_data_topic.push(info.parent + '/' + info.name + '/orig');
                            pub_lte_msw_data_topic.push(info.parent + '/' + info.name);
                        }
                    }
                }

                chk_cnt = 'sub_container';
                if (conf.drone_info.mission[mission_name].hasOwnProperty(chk_cnt)) {
                    for (let idx in conf.drone_info.mission[mission_name][chk_cnt]) {
                        if (conf.drone_info.mission[mission_name][chk_cnt].hasOwnProperty(idx)) {
                            let container_name = conf.drone_info.mission[mission_name][chk_cnt][idx];

                            info = {};
                            info.parent = '/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name;
                            info.name = container_name;
                            conf.cnt.push(JSON.parse(JSON.stringify(info)));

                            pub_msw_control_topic.push(info.parent + '/' + info.name + '/orig');
                            sub_lte_msw_control_topic.push(info.parent + '/' + info.name);

                            info = {};
                            info.parent = '/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name + '/' + container_name;
                            info.name = 'sub_msw';
                            info.nu = 'mqtt://' + conf.cse.host + '/' + conf.ae.id + '?ct=json';
                            conf.sub.push(JSON.parse(JSON.stringify(info)));
                        }
                    }
                }

                chk_cnt = 'git';
                if (conf.drone_info.mission[mission_name].hasOwnProperty(chk_cnt)) {
                    let repo_arr = conf.drone_info.mission[mission_name][chk_cnt].split('/');
                    let directory_name = mission_name + '_' + repo_arr[repo_arr.length - 1].replace('.git', '');
                    try {
                        if (fs.existsSync('./' + directory_name)) {
                            setTimeout(git_pull, 10, mission_name, directory_name, arguments);
                        }
                        else {
                            setTimeout(git_clone, 10, mission_name, directory_name, conf.drone_info.mission[mission_name][chk_cnt], arguments);
                        }
                    }
                    catch (e) {
                        console.log(e.message);
                    }
                }
            }
        }
    }

    MQTT_SUBSCRIPTION_ENABLE = 1;

    sh_state = 'crtct';

    setTimeout(http_watchdog, normal_interval);
}

function http_watchdog() {
    if (sh_state === 'crtct') {
        console.log('[sh_state] : ' + sh_state);
        create_cnt_all(request_count, (status, count) => {
            if (status === 9999) {
                setTimeout(http_watchdog, retry_interval);
            }
            else {
                request_count = ++count;
                return_count = 0;
                if (conf.cnt.length <= count) {
                    sh_state = 'delsub';
                    request_count = 0;
                    return_count = 0;

                    setTimeout(http_watchdog, normal_interval);
                }
            }
        });
    }
    else if (sh_state === 'delsub') {
        console.log('[sh_state] : ' + sh_state);
        delete_sub_all(request_count, (status, count) => {
            if (status === 9999) {
                setTimeout(http_watchdog, retry_interval);
            }
            else {
                request_count = ++count;
                return_count = 0;
                if (conf.sub.length <= count) {
                    sh_state = 'crtsub';
                    request_count = 0;
                    return_count = 0;

                    setTimeout(http_watchdog, normal_interval);
                }
            }
        });
    }
    else if (sh_state === 'crtsub') {
        console.log('[sh_state] : ' + sh_state);
        create_sub_all(request_count, (status, count) => {
            if (status === 9999) {
                setTimeout(http_watchdog, retry_interval);
            }
            else {
                request_count = ++count;
                return_count = 0;
                if (conf.sub.length <= count) {
                    sh_state = 'crtci';

                    dr_mqtt_connect('127.0.0.1');

                    ready_for_notification();

                    mobius_mqtt_connect(conf.drone_info.host);

                    setTimeout(http_watchdog, normal_interval);
                }
            }
        });
    }
    else if (sh_state === 'crtci') {
        console.log('[sh_state] : ' + sh_state);
    }
}


function git_clone(mission_name, directory_name, repository_url, arguments) {
    console.log('[Git] Mission(' + mission_name + ') cloning...');
    try {
        require('fs-extra').removeSync('./' + directory_name);
    }
    catch (e) {
        console.log(e.message);
    }

    let gitClone = spawn('git', ['clone', repository_url, directory_name]);

    gitClone.stdout.on('data', (data) => {
        console.log('[ ' + mission_name + ' ] stdout: ' + data);
    });

    gitClone.stderr.on('data', (data) => {
        console.log('[ ' + mission_name + ' ] stderr: ' + data);
    });

    gitClone.on('exit', (code) => {
        console.log('[ ' + mission_name + ' ] exit: ' + code);

        setTimeout(npm_install, 5000, mission_name, directory_name, arguments);
    });

    gitClone.on('error', (code) => {
        console.log('[ ' + mission_name + ' ] error: ' + code);
    });
}

function git_pull(mission_name, directory_name, arguments) {
    console.log('[Git] Mission(' + mission_name + ') pull...');
    try {
        let cmd;
        if (process.platform === 'win32') {
            cmd = 'git';
        }
        else {
            cmd = 'git';
        }

        let gitPull = spawn(cmd, ['pull'], {cwd: process.cwd() + '/' + directory_name});

        gitPull.stdout.on('data', (data) => {
            console.log('[ ' + mission_name + ' ] stdout: ' + data);
        });

        gitPull.stderr.on('data', (data) => {
            console.log('[ ' + mission_name + ' ] stderr: ' + data);
            if (data.includes('Could not resolve host')) {
                setTimeout(npm_install, 1000, mission_name, directory_name, arguments);
            }
        });

        gitPull.on('exit', (code) => {
            console.log('[ ' + mission_name + ' ] exit: ' + code);

            setTimeout(npm_install, 1000, mission_name, directory_name, arguments);
        });

        gitPull.on('error', (code) => {
            console.log('[ ' + mission_name + ' ] error: ' + code);
        });
    }
    catch (e) {
        console.log(e.message);
    }
}

function npm_install(mission_name, directory_name, arguments) {
    console.log('npm_install [ ' + mission_name + ' ]');

    try {
        let cmd;
        if (process.platform === 'win32') {
            cmd = 'npm.cmd';
        }
        else {
            cmd = 'npm';
        }

        let npmInstall = spawn(cmd, ['install'], {cwd: process.cwd() + '/' + directory_name});

        npmInstall.stdout.on('data', (data) => {
            console.log('[ ' + mission_name + ' ] stdout: ' + data);
        });

        npmInstall.stderr.on('data', (data) => {
            console.log('[ ' + mission_name + ' ] stderr: ' + data);
        });

        npmInstall.on('exit', (code) => {
            console.log('[ ' + mission_name + ' ] exit: ' + code);

            setTimeout(fork_msw, 10, mission_name, directory_name, arguments)
        });

        npmInstall.on('error', (code) => {
            console.log('[ ' + mission_name + ' ] error: ' + code);

            setTimeout(npm_install, 1000, mission_name, directory_name, arguments);
        });
    }
    catch (e) {
        console.log(e.message);
    }
}

function fork_msw(mission_name, directory_name, arguments) {
    console.log('fork_msw [ ' + mission_name + ' ]');

    exec('pm2 list', (error, stdout, stderr) => {
        if (error) {
            console.log('[ ' + mission_name + ' ] error: ' + error);
        }
        if (stdout) {
            console.log('[ ' + mission_name + ' ] stdout: \n' + stdout);
            let pm2_lists = stdout.split('\n');
            if (mission_name === 'msw_webrtc_crow') {
                let pm2_names = [];
                for (let idx in pm2_lists) {
                    if (pm2_lists.hasOwnProperty(idx)) {
                        let pm2_list = pm2_lists[idx].split('│');
                        let name = pm2_list[2]
                        if (name !== undefined && name.includes('msw')) {
                            pm2_names.push(name.trim(' ', ''));
                        }
                    }
                }

                if (arguments) {
                    for (let c_idx in arguments) {
                        if (arguments.hasOwnProperty(c_idx)) {
                            let pm2_mission_name = mission_name + '_' + arguments[c_idx].split('=')[0];

                            if (pm2_names.includes(pm2_mission_name)) {
                                let nodeMsw = exec('pm2 restart ' + pm2_mission_name + ' -- ' + arguments[c_idx], {cwd: process.cwd() + '/' + directory_name});
                                nodeMsw.stdout.on('data', (data) => {
                                    console.log('[ ' + mission_name + ' ] restart stdout: \n' + data);
                                });

                                nodeMsw.stderr.on('data', (data) => {
                                    console.log('[ ' + mission_name + ' ] restart stderr: ' + data);
                                });

                                nodeMsw.on('exit', (code) => {
                                    console.log('[ ' + mission_name + ' ] restart exit: ' + code);
                                });

                                nodeMsw.on('error', (code) => {
                                    console.log('[ ' + mission_name + ' ] restart error: ' + code);

                                    setTimeout(npm_install, 10, directory_name, arguments);
                                });
                            }
                            else {
                                let nodeMsw = exec('pm2 start ' + mission_name + '.js --name ' + pm2_mission_name + ' -- ' + arguments[c_idx], {cwd: process.cwd() + '/' + directory_name});
                                nodeMsw.stdout.on('data', (data) => {
                                    console.log('[ ' + mission_name + ' ] start stdout: \n' + data);
                                });

                                nodeMsw.stderr.on('data', (data) => {
                                    console.log('[ ' + mission_name + ' ] start stderr: ' + data);
                                });

                                nodeMsw.on('exit', (code) => {
                                    console.log('[ ' + mission_name + ' ] start exit: ' + code);
                                });

                                nodeMsw.on('error', (code) => {
                                    console.log('[ ' + mission_name + ' ] start error: ' + code);

                                    setTimeout(npm_install, 10, directory_name, arguments);
                                });
                            }
                        }
                    }
                }
                else { // arguments = undefined
                    if (pm2_names.includes(mission_name)) {
                        let nodeMsw = exec('pm2 restart ' + mission_name + '.js -- undefined=webcam', {cwd: process.cwd() + '/' + directory_name});
                        nodeMsw.stdout.on('data', (data) => {
                            console.log('[ ' + mission_name + ' ] stdout: \n' + data);
                        });

                        nodeMsw.stderr.on('data', (data) => {
                            console.log('[ ' + mission_name + ' ] stderr: ' + data);
                        });

                        nodeMsw.on('exit', (code) => {
                            console.log('[ ' + mission_name + ' ] exit: ' + code);
                        });

                        nodeMsw.on('error', (code) => {
                            console.log('[ ' + mission_name + ' ] error: ' + code);

                            setTimeout(npm_install, 10, directory_name, arguments);
                        });
                    }
                    else {
                        let nodeMsw = exec('pm2 start ' + mission_name + '.js -- undefined=webcam', {cwd: process.cwd() + '/' + directory_name});
                        nodeMsw.stdout.on('data', (data) => {
                            console.log('[ ' + mission_name + ' ] stdout: \n' + data);
                        });

                        nodeMsw.stderr.on('data', (data) => {
                            console.log('[ ' + mission_name + ' ] stderr: ' + data);
                        });

                        nodeMsw.on('exit', (code) => {
                            console.log('[ ' + mission_name + ' ] exit: ' + code);
                        });

                        nodeMsw.on('error', (code) => {
                            console.log('[ ' + mission_name + ' ] error: ' + code);

                            setTimeout(npm_install, 10, directory_name, arguments);
                        });
                    }
                }
            }
            else {
                if (!stdout.includes(mission_name)) {
                    let nodeMsw = exec('pm2 start ' + mission_name + '.js', {cwd: process.cwd() + '/' + directory_name});
                    nodeMsw.stdout.on('data', (data) => {
                        console.log('[ ' + mission_name + ' ] stdout: \n' + data);
                    });

                    nodeMsw.stderr.on('data', (data) => {
                        console.log('[ ' + mission_name + ' ] stderr: ' + data);
                    });

                    nodeMsw.on('exit', (code) => {
                        console.log('[ ' + mission_name + ' ] exit: ' + code);
                    });

                    nodeMsw.on('error', (code) => {
                        console.log('[ ' + mission_name + ' ] error: ' + code);

                        setTimeout(npm_install, 10, directory_name, arguments);
                    });
                }
                else {
                    let nodeMsw = exec('pm2 restart ' + mission_name, {cwd: process.cwd() + '/' + directory_name});
                    nodeMsw.stdout.on('data', (data) => {
                        console.log('[ ' + mission_name + ' ] stdout: \n' + data);
                    });

                    nodeMsw.stderr.on('data', (data) => {
                        console.log('[ ' + mission_name + ' ] stderr: ' + data);
                    });

                    nodeMsw.on('exit', (code) => {
                        console.log('[ ' + mission_name + ' ] exit: ' + code);
                    });

                    nodeMsw.on('error', (code) => {
                        console.log('[ ' + mission_name + ' ] error: ' + code);

                        setTimeout(npm_install, 10, directory_name, arguments);
                    });
                }
            }
        }
        if (stderr) {
            console.log('stderr: ' + stderr);
        }
    });
}

function ready_for_notification() {
    for (let i = 0; i < conf.sub.length; i++) {
        if (conf.sub[i].name) {
            let notification_url = new URL(conf.sub[i].nu);
            if (notification_url.protocol === 'mqtt:') {
                if (notification_url.hostname === 'autoset') {
                    conf.sub[i]['nu'] = 'mqtt://' + conf.cse.host + '/' + conf.ae.id;
                    noti_topic = util.format('/oneM2M/req/+/%s/#', conf.ae.id);
                }
                else if (notification_url.hostname === conf.cse.host) {
                    noti_topic = util.format('/oneM2M/req/+/%s/#', conf.ae.id);
                }
                else {
                    noti_topic = util.format('%s', notification_url.pathname);
                }
            }
        }
    }
}

function create_cnt_all(count, callback) {
    if (conf.cnt.length === 0) {
        callback(2001, count);
    }
    else {
        if (conf.cnt.hasOwnProperty(count)) {
            let parent = conf.cnt[count].parent;
            let rn = conf.cnt[count].name;
            onem2m_client.crtct(parent, rn, count, (rsc, res_body, count) => {
                if (rsc === 5106 || rsc === 2001 || rsc === 4105) {
                    create_cnt_all(++count, (status, count) => {
                        callback(status, count);
                    });
                }
                else {
                    callback(9999, count);
                }
            });
        }
        else {
            callback(2001, count);
        }
    }
}

function delete_sub_all(count, callback) {
    if (conf.sub.length === 0) {
        callback(2001, count);
    }
    else {
        if (conf.sub.hasOwnProperty(count)) {
            let target = conf.sub[count].parent + '/' + conf.sub[count].name;
            onem2m_client.delsub(target, count, (rsc, res_body, count) => {
                if (rsc === 5106 || rsc === 2002 || rsc === 2000 || rsc === 4105 || rsc === 4004) {
                    delete_sub_all(++count, (status, count) => {
                        callback(status, count);
                    });
                }
                else {
                    callback(9999, count);
                }
            });
        }
        else {
            callback(2001, count);
        }
    }
}

function create_sub_all(count, callback) {
    if (conf.sub.length === 0) {
        callback(2001, count);
    }
    else {
        if (conf.sub.hasOwnProperty(count)) {
            let parent = conf.sub[count].parent;
            let rn = conf.sub[count].name;
            let nu = conf.sub[count].nu;
            onem2m_client.crtsub(parent, rn, nu, count, (rsc, res_body, count) => {
                if (rsc === 5106 || rsc === 2001 || rsc === 4105) {
                    create_sub_all(++count, (status, count) => {
                        callback(status, count);
                    });
                }
                else {
                    callback(9999, count);
                }
            });
        }
        else {
            callback(2001, count);
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
            clientId: 'od-dr-tele-relay_local_' + nanoid(15),
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

            if (sub_drone_topic !== '') {
                dr_mqtt_client.subscribe(sub_drone_topic, () => {
                    console.log('[dr_mqtt_client] sub_drone_topic is subscribed: ' + sub_drone_topic);
                });
            }
            if (sub_sortie_topic !== '') {
                dr_mqtt_client.subscribe(sub_sortie_topic, () => {
                    console.log('[dr_mqtt_client] sub_sortie_topic is subscribed: ' + sub_sortie_topic);
                });
            }
            for (let idx in sub_msw_data_topic) {
                if (sub_msw_data_topic.hasOwnProperty(idx)) {
                    dr_mqtt_client.subscribe(sub_msw_data_topic[idx], () => {
                        console.log('[dr_mqtt_client] sub_msw_data_topic[ ' + idx + ' ] is subscribed: ' + sub_msw_data_topic[idx]);
                    });
                }
            }
            if (noti_topic !== '') {
                dr_mqtt_client.subscribe(noti_topic, () => {
                    console.log('[dr_mqtt_client] noti_topic is subscribed: ' + noti_topic);
                });
            }
        });

        dr_mqtt_client.on('message', (topic, message) => {
            let topic_arr = topic.split('/');

            if (topic_arr[3] === 'Drone_Data' && topic_arr[6] === 'orig') {
                if (mobius_mqtt_client) {
                    mobius_mqtt_client.publish(pub_lte_drone_topic, message, () => {
                        // console.log("[LTE](" + moment().format('YYYY-MM-DD hh:mm:ssSSS') + ") send to " + pub_lte_drone_topic + " -", message.toString('hex'));
                    });
                }

                send_aggr_to_Mobius(my_cnt_name, message.toString('hex'), 2000);
            }
            else if (topic === sub_sortie_topic) {
                let arr_message = message.toString().split(':');
                let _my_sortie_name = arr_message[0];
                let time_boot_ms = arr_message[1];

                if (_my_sortie_name === 'unknown-arm') { // 시작될 때 이미 드론이 시동이 걸린 상태
                    // 모비우스 조회해서 현재 sortie를 찾아서 설정함
                    let path = 'http://' + conf.cse.host + ':' + conf.cse.port + '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone;
                    let cra = moment().utc().format('YYYYMMDD');

                    onem2m_client.getSortieLatest(path, cra, (status, uril) => {
                        if (uril.length === 0) {
                            // 현재 시동이 걸린 상태인데 오늘 생성된 sortie가 없다는 뜻이므로 새로 만듦
                            my_sortie_name = moment().format('YYYY_MM_DD_T_HH_mm');

                            pub_lte_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';
                            my_cnt_name = my_parent_cnt_name + '/' + my_sortie_name;

                            onem2m_client.createSortieContainer(my_parent_cnt_name + '?rcn=0', my_sortie_name, time_boot_ms, 0, (rsc, res_body, count) => {
                            });
                        }
                        else {
                            my_sortie_name = uril[0].split('/')[4];

                            pub_lte_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';
                            my_cnt_name = my_parent_cnt_name + '/' + my_sortie_name;
                        }
                    });
                }
                else if (_my_sortie_name === 'unknown-disarm') { // 시작될 때 드론이 시동이 꺼진 상태
                    // disarm sortie 적용
                    my_sortie_name = 'disarm';

                    pub_lte_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';
                    my_cnt_name = my_parent_cnt_name + '/' + my_sortie_name;
                }
                else if (_my_sortie_name === 'disarm-arm') { // 드론이 꺼진 상태에서 시동이 걸리는 상태
                    // 새로운 sortie 만들어 생성하고 설정
                    my_sortie_name = moment().format('YYYY_MM_DD_T_HH_mm');

                    pub_lte_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';
                    my_cnt_name = my_parent_cnt_name + '/' + my_sortie_name;

                    onem2m_client.createSortieContainer(my_parent_cnt_name + '?rcn=0', my_sortie_name, time_boot_ms, 0, (rsc, res_body, count) => {
                    });
                }
                else if (_my_sortie_name === 'arm-disarm') { // 드론이 시동 걸린 상태에서 시동이 꺼지는 상태
                    // disarm sortie 적용
                    my_sortie_name = 'disarm';

                    pub_lte_drone_topic = '/Mobius/' + conf.drone_info.gcs + '/Drone_Data/' + conf.drone_info.drone + '/' + my_sortie_name + '/orig';
                    my_cnt_name = my_parent_cnt_name + '/' + my_sortie_name;
                }
            }
            else if (topic_arr[3] === 'Mission_Data' && sub_msw_data_topic.includes(topic) && topic_arr[7] === 'orig') {
                let mission_name = topic_arr[5];
                let data_name = topic_arr[6];

                let _msw_data_topic = '/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name + '/' + data_name;
                if (pub_lte_msw_data_topic.includes(_msw_data_topic)) {
                    if (mobius_mqtt_client) {
                        mobius_mqtt_client.publish(_msw_data_topic, message, () => {
                            try {
                                onem2m_client.crtci(_msw_data_topic + '?rcn=0', 0, JSON.parse(message.toString()), null, () => {
                                });
                            }
                            catch (e) {
                                onem2m_client.crtci(_msw_data_topic + '?rcn=0', 0, message.toString(), null, () => {
                                });
                            }
                        });
                    }
                }
            }
            else if (topic_arr[1] === 'oneM2M') {
                let con;
                if (topic_arr[4] === conf.ae.id) {
                    let json_msg = JSON.parse(message.toString());
                    let mission_name;
                    let control_name;
                    if (json_msg.hasOwnProperty('pc')) {
                        if (json_msg.pc.hasOwnProperty("m2m:sgn")) {
                            if (json_msg.pc["m2m:sgn"].hasOwnProperty("nev")) {
                                let topic_arr = json_msg.pc["m2m:sgn"].sur.split('/');
                                mission_name = topic_arr[4];
                                control_name = topic_arr[5];
                            }
                            if (json_msg.pc["m2m:sgn"].hasOwnProperty("nev")) {
                                if (json_msg.pc["m2m:sgn"].nev.hasOwnProperty("rep")) {
                                    if (json_msg.pc["m2m:sgn"].nev.rep.hasOwnProperty("m2m:cin")) {
                                        if (json_msg.pc["m2m:sgn"].nev.rep["m2m:cin"].hasOwnProperty("con")) {
                                            con = json_msg.pc["m2m:sgn"].nev.rep["m2m:cin"].con;
                                            if (typeof con === 'string') {
                                                if (dr_mqtt_client) {
                                                    dr_mqtt_client.publish('/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name + '/' + control_name + '/orig', con);
                                                }
                                            }
                                            else if (typeof con === 'object') {
                                                if (dr_mqtt_client) {
                                                    dr_mqtt_client.publish('/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name + '/' + control_name + '/orig', JSON.stringify(con));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        dr_mqtt_client.on('error', (err) => {
            console.log('[dr_mqtt_client] (error) ' + err.message);
        });
    }
}

function mobius_mqtt_connect(serverip) {
    if (!mobius_mqtt_client) {
        let connectOptions = {};
        if (conf.usesecure === 'disable') {
            connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
                protocol: "mqtt",
                keepalive: 10,
                clientId: 'od-dr-tele-relay_global_' + nanoid(15),
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2 * 1000,
                connectTimeout: 30 * 1000,
                rejectUnauthorized: false
            }
        }
        else {
            connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
                protocol: "mqtts",
                keepalive: 10,
                clientId: 'od-dr-tele-relay_global_' + nanoid(15),
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2 * 1000,
                connectTimeout: 30 * 1000,
                queueQoSZero: false,
                key: fs.readFileSync("./server-key.pem"),
                cert: fs.readFileSync("./server-crt.pem"),
                rejectUnauthorized: false
            }
        }

        mobius_mqtt_client = mqtt.connect(connectOptions);

        mobius_mqtt_client.on('connect', () => {
            console.log('mobius_mqtt_client is connected to ( ' + serverip + ' )');

            if (noti_topic !== '') {
                mobius_mqtt_client.subscribe(noti_topic, () => {
                    console.log('[mobius_mqtt_client] noti_topic is subscribed: ' + noti_topic);
                });
            }
            if (sub_lte_gcs_topic !== '') {
                mobius_mqtt_client.subscribe(sub_lte_gcs_topic, () => {
                    console.log('[mobius_mqtt_client] sub_lte_gcs_topic is subscribed: ' + sub_lte_gcs_topic);
                });
            }
            for (let idx in sub_lte_msw_control_topic) {
                if (sub_lte_msw_control_topic.hasOwnProperty(idx)) {
                    mobius_mqtt_client.subscribe(sub_lte_msw_control_topic[idx], () => {
                        console.log('[mobius_mqtt_client] sub_lte_msw_control_topic[ ' + idx + ' ] is subscribed: ' + sub_lte_msw_control_topic[idx]);
                    });
                }
            }
        });

        mobius_mqtt_client.on('message', (topic, message) => {
            let topic_arr = topic.split('/');

            if (topic.substring(0, 7) === '/oneM2M') {
                let con;
                let topic_arr = topic.split('/');
                if (topic_arr[4] === conf.ae.id) {
                    let json_msg = JSON.parse(message.toString());
                    let mission_name;
                    let control_name;
                    if (json_msg.hasOwnProperty('pc')) {
                        if (json_msg.pc.hasOwnProperty("m2m:sgn")) {
                            if (json_msg.pc["m2m:sgn"].hasOwnProperty("nev")) {
                                let topic_arr = json_msg.pc["m2m:sgn"].sur.split('/');
                                mission_name = topic_arr[4];
                                control_name = topic_arr[5];
                            }
                            if (json_msg.pc["m2m:sgn"].hasOwnProperty("nev")) {
                                if (json_msg.pc["m2m:sgn"].nev.hasOwnProperty("rep")) {
                                    if (json_msg.pc["m2m:sgn"].nev.rep.hasOwnProperty("m2m:cin")) {
                                        if (json_msg.pc["m2m:sgn"].nev.rep["m2m:cin"].hasOwnProperty("con")) {
                                            con = json_msg.pc["m2m:sgn"].nev.rep["m2m:cin"].con;
                                            if (typeof con === 'string') {
                                                if (dr_mqtt_client) {
                                                    dr_mqtt_client.publish('/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name + '/' + control_name + '/orig', con);
                                                }
                                            }
                                            else if (typeof con === 'object') {
                                                if (dr_mqtt_client) {
                                                    dr_mqtt_client.publish('/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name + '/' + control_name + '/orig', JSON.stringify(con));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else if (topic === sub_lte_gcs_topic&&disconnected) {
                let gcsData = message.toString('hex');
                let sequence;

                    if (gcsData.substring(0, 2) === 'fe') {
                        sequence = parseInt(gcsData.substring(4, 6), 16);
                        if (GCSData.hasOwnProperty(sequence)) {
                            delete GCSData[sequence];
                            return;
                        }
                    }
                    else if (gcsData.substring(0, 2) === 'fd') {
                        sequence = parseInt(gcsData.substring(8, 10), 16);
                        if (GCSData.hasOwnProperty(sequence)) {
                            delete GCSData[sequence];
                            return;
                        }
                    }

                    console.log('[LTE-GCS]', sequence);
                    gcs_noti_handler(message);
            }
            else if (topic_arr[3] === 'Mission_Data' && sub_lte_msw_control_topic.includes(topic)) {
                let mission_name = topic_arr[5];
                let control_name = topic_arr[6];
                let missionCtrlData;

                let _msw_control_topic = '/Mobius/' + conf.drone_info.gcs + '/Mission_Data/' + conf.drone_info.drone + '/' + mission_name + '/' + control_name + '/orig';

                try {
                    missionCtrlData = JSON.parse(message.toString());
                    if (missionCtrlData.hasOwnProperty('sequence')) {
                        mctrl_sequence = missionCtrlData.sequence;
                    }
                    else {
                        mctrl_sequence = mctrl_sequence + 1;
                    }
                    missionCtrlData = JSON.stringify(missionCtrlData);
                    console.log('[LTE-Mission] JSON -', mctrl_sequence);
                }
                catch (e) {
                    let _data = message.toString();
                    mctrl_sequence = parseInt(_data.substring(0, 2), 16);
                    if (Number(mctrl_sequence)) {
                        missionCtrlData = _data.substring(2, _data.length);
                    }
                    else {
                        missionCtrlData = _data;
                        mctrl_sequence = mctrl_sequence + 1;
                    }
                    console.log('[LTE-Mission] string -', mctrl_sequence);
                }

                // if (MissionControlData.hasOwnProperty(mctrl_sequence)) {
                //     delete MissionControlData[mctrl_sequence];
                //     return;
                // }
                // else {
                if (mc_disconnected) {
                    if (dr_mqtt_client) {
                        // TODO: Mission 명령은 sequence 초기화 하도록 변경? 굳이 sequence 쌓을 필요 없을듯
                        dr_mqtt_client.publish(_msw_control_topic, missionCtrlData);
                    }
                }
            }
        });

        mobius_mqtt_client.on('error', (err) => {
            console.log('[mobius_mqtt_client] (error) ' + err.message);
        });
    }
}

let aggr_content = {};

function send_aggr_to_Mobius(topic, content_each, gap) {
    if (aggr_content.hasOwnProperty(topic)) {
        var timestamp = moment().format('YYYY-MM-DDTHH:mm:ssSSS');
        aggr_content[topic][timestamp] = content_each;
    }
    else {
        aggr_content[topic] = {};
        timestamp = moment().format('YYYY-MM-DDTHH:mm:ssSSS');
        aggr_content[topic][timestamp] = content_each;

        setTimeout(() => {
            onem2m_client.crtci(topic + '?rcn=0', 0, aggr_content[topic], null, () => {
            });

            delete aggr_content[topic]
        }, gap, topic);
    }
}
