var request = require('request');

var devices = {};

module.exports.init = function(devices_data, callback) {
    Homey.log(devices_data);
    devices_data.forEach(initDevice);
    callback(null, true); 
};

module.exports.pair = function(socket) {
    // Validate PVOutput data
    socket.on('validate', function( data, callback ){
        Homey.log('Validating', data);

        var url     = 'http://pvoutput.org/service/r2/getstatus.jsp?key=' + data.key + '&sid=' + data.sid;

        request(url, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                Homey.log('Pairing successful!');
                callback(null, true);
            } else {
                Homey.log('Error during pairing');
                callback(body, null);
            }
        })
    })
    
    socket.on('add_device', function( device_data, callback ){
        initDevice(device_data);
        callback(null, true);
    });
};

module.exports.deleted = function(device_data, callback) {
    Homey.log('Deleting ' + device_data.id);

    Homey.manager('cron').unregisterTask('solar_' + device_data.id, function(err, success) {});

    delete devices[device_data.id];
};

module.exports.renamed = function( device_data, new_name ) {
    devices[device_data.id].name = new_name;

    Homey.log(device_data.id + ' has been renamed to ' + new_name);
}

module.exports.capabilities = {
    measure_power: {
        get: function(device_data, callback) {
            var device = devices[device_data.id];

            callback(null, device.last_power);
        }
    },
    meter_power: {
        get: function(device_data, callback) {
            var device = devices[device_data.id];
            
            callback(null, device.last_energy);
        }
    }
};

function initDevice(data) {

    devices[data.id] = {
            name       : data.name,
            last_output: '0:00',
            last_power : 0,
            last_energy: 0,
            data       : data
    }
    
    // Create cron job for production check
    var taskName = 'solar_' + data.id;
    Homey.manager('cron').unregisterTask(taskName, function(err, success) {
        Homey.manager('cron').registerTask(taskName, '*/5 * * * *', data, function(err, task) {})
    });

    Homey.manager('cron').on(taskName, function(data_cron) {
        Homey.log('Checking production for ' + data_cron.name);
        checkProduction(data_cron);
    })

}

function checkProduction(data) {
    var device_data = devices[data.id]

    var url = 'http://pvoutput.org/service/r2/getstatus.jsp?key=' + data.key + '&sid=' + data.id;

    request(url, function(error, response, body) {

        if (!error && response.statusCode == 200) {
            module.exports.setAvailable(device_data);

            var parsedResponse = body.split(',');
            var lastOutputTime = parsedResponse[1];

            if (lastOutputTime != device_data.last_output) {
                Homey.log('Parsing response!');

                device_data.last_output = lastOutputTime;

                var currentEnergy = Number(parsedResponse[2]) / 1000;
                device_data.last_energy = currentEnergy;
                module.exports.realtime(data, "meter_power", currentEnergy);

                var currentPower = Number(parsedResponse[3]);
                device_data.last_power = currentPower;
                module.exports.realtime(data, "measure_power", currentPower);
            } else {
                Homey.log('No new data for ' + data.name);
            }
        } else {
            Homey.log('Status code: ' + response.statusCode);
            module.exports.setUnavailable(device_data.data, 'Received a ' + response.statusCode + ' error');
        }

    })
}