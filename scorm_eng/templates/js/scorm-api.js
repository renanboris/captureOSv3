var ScormAPI = {
    pipwerks: null,
    isLMS: false,
    
    init: function() {
        var pipwerks = {};
        pipwerks.SCORM = {
            version: "1.2",
            connection: { isActive: false },
            API: { handle: null, isFound: false }
        };
        
        var findAPI = function(win) {
            var attempts = 0, limit = 500;
            while ((!win.API && !win.API_1484_11) &&
                   (win.parent) && (win.parent != win) &&
                   (attempts <= limit)){
                attempts++;
                win = win.parent;
            }
            return win.API;
        };
        
        var api = findAPI(window);
        
        if (api) {
            pipwerks.SCORM.API.handle = api;
            pipwerks.SCORM.API.isFound = true;
            this.isLMS = true;
        } else {
            console.log("LMS não encontrado. Executando em modo standalone (localStorage).");
        }
        
        this.pipwerks = pipwerks;
        
        if (this.isLMS) {
            var result = this.pipwerks.SCORM.API.handle.LMSInitialize("");
            if (result === "true" || result === true || result === "1" || result === 1) {
                this.pipwerks.SCORM.connection.isActive = true;
                return true;
            }
            return false;
        }
        return true;
    },
    
    set: function(key, value) {
        if (!this.isLMS) {
            var modId = window.moduloId || 'standalone';
            localStorage.setItem(`scorm_${modId}_${key}`, String(value));
            return true;
        }
        if (!this.pipwerks.SCORM.connection.isActive) return false;
        var res = this.pipwerks.SCORM.API.handle.LMSSetValue(key, String(value));
        return (res === "true" || res === true || res === "1" || res === 1);
    },
    
    get: function(key) {
        if (!this.isLMS) {
            var modId = window.moduloId || 'standalone';
            return localStorage.getItem(`scorm_${modId}_${key}`);
        }
        if (!this.pipwerks.SCORM.connection.isActive) return null;
        return this.pipwerks.SCORM.API.handle.LMSGetValue(key);
    },
    
    save: function() {
        if (!this.isLMS) return true;
        if (!this.pipwerks.SCORM.connection.isActive) return false;
        var res = this.pipwerks.SCORM.API.handle.LMSCommit("");
        return (res === "true" || res === true || res === "1" || res === 1);
    },
    
    quit: function() {
        if (!this.isLMS) return true;
        if (!this.pipwerks.SCORM.connection.isActive) return false;
        var res = this.pipwerks.SCORM.API.handle.LMSFinish("");
        return (res === "true" || res === true || res === "1" || res === 1);
    }
};
