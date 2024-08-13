# oneDrone-np

for drone
***

## Settings
#### 1. Mosquitto broker
- install mosquitto broker
```shell
  > sh install_MQTT-broker.sh
```
- edit config file
```shell
  > sudo nano /etc/mosquitto/conf.d/default.conf
```
- add code
```
listener 1883
protocol mqtt
listener 8883
protocol websockets
socket_domain ipv4
allow_anonymous true
```
- restart mosquitto service
```shell
> sudo service mosquitto restart
```

#### 2. Node.JS package
- install
```shell
> npm install
```

## Prepare
### 1. drone_info.json
- create
```shell
> nano drone_info.json
```
- edit
```json
{
    "id": "Dione",
    "approval_gcs": "MUV",
    "host": "gcs.iotocean.org",
    "drone": "KETI_Drone",
    "gcs": "KETI_GCS",
    "system_id": 250
}
```

## Run
- default
```shell
> npm start
```
