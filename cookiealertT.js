document.getElementById("popupAlert").innerHTML = "<div class='alert text-center cookiealert' role='alert' style='font-size:14px;'>เว็บไซต์นี้ใช้คุกกี้<br>เราใช้คุกกี้เพื่อนำเสนอเนื้อหาและโฆษณาที่ท่านอาจสนใจ เพื่อให้ท่านได้รับประสบการณ์ที่ดียิ่งขึ้น <a href='https://www.rajthanee.com/th/%E0%B8%99%E0%B9%82%E0%B8%A2%E0%B8%9A%E0%B8%B2%E0%B8%A2%E0%B8%84%E0%B8%B8%E0%B8%81%E0%B8%81%E0%B8%B5%E0%B9%89' target='_blank' style='color:#669FED;text-decoration: underline;'>อ่านเพิ่มเติม</a><button type='button' class='btn btn-success btn-sm acceptcookies' style='background-color:#67CD4C;color:#fff;'>Accept</button><button type='button' class='btn btn-primary btn-sm acceptcookiesNO' style='background-color:#4C83CD;color:#fff;'>Deny</button></div><span id='popupAlertDetail'></span>";


var CheckCookie = getValue('acceptCookies');
if(CheckCookie == 'true'){
	getDRJH();
}
var CheckCookieT = getValue('_atk');
if(CheckCookieT != ''){
	
}
else{
	getDCHECKTOKEN();
}
	
(function () {
    "use strict";

    var cookieAlert = document.querySelector(".cookiealert");
    var acceptCookies = document.querySelector(".acceptcookies");
	var acceptcookiesNO = document.querySelector(".acceptcookiesNO");

    if (!cookieAlert) {
       return;
    }

    cookieAlert.offsetHeight; // Force browser to trigger reflow 

    // Show the alert if we cant find the "acceptCookies" cookie
    if (!getCookie("acceptCookies")) {
        cookieAlert.classList.add("show");
    }


    // When clicking on the agree button, create a 1 year
    // cookie to remember user's choice and close the banner
    acceptCookies.addEventListener("click", function () {
        setCookie("acceptCookies", true, 30);
        cookieAlert.classList.remove("show");
		
		getIP();
		setTimeout(getDRJH,2000);
		
        // dispatch the accept event
        window.dispatchEvent(new Event("cookieAlertAccept"))
    });
	
	acceptcookiesNO.addEventListener("click", function () {
		setCookie("acceptCookies", false, 1);
		cookieAlert.classList.remove("show");
		// dispatch the accept event
        window.dispatchEvent(new Event("cookieAlertAccept"))
    });
	
    
})();

// Cookie functions from w3schools
function setCookie(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires=" + d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function getCookie(cname) {
    var name = cname + "=";
    var decodedCookie = decodeURIComponent(document.cookie);
    var ca = decodedCookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) === 0) {
            return c.substring(name.length, c.length);
		}
    }
    return "";
}

function getValue(x){
	
	if(x == 'acceptIPaddress'){
		cookieValue = document.cookie.split('; ').find(row => row.startsWith(x+'='));
		if(cookieValue == undefined){
			cookieValue = getIP();
		}
		else{
			cookieValue = document.cookie.split('; ').find(row => row.startsWith(x+'=')).split('=')[1];
		}
	}
	else if(x == 'acceptURL'){
		cookieValue = document.cookie.split('; ').find(row => row.startsWith(x+'='));
		if(cookieValue == undefined){
			cookieValue = window.location.href;
		}
		else{
			cookieValue = document.cookie.split('; ').find(row => row.startsWith(x+'=')).split('=')[1];
		}
	}
	else{
		cookieValue = document.cookie.split('; ').find(row => row.startsWith(x+'='));
		if(cookieValue == undefined){
			cookieValue = '';
		}
		else{
			cookieValue = document.cookie.split('; ').find(row => row.startsWith(x+'=')).split('=')[1];
		}
	}
	
	return cookieValue;
}
function getDRJH(){
	
	const acceptCookies = getValue('acceptCookies');
	const _atk = getValue('_atk');
	const _pde = getValue('_pde');
	const acceptURL = getValue('acceptURL');
	const _ipd = getValue('_ipd');

	
	if(_atk != '' && acceptCookies == "true"){
		
		var myHeaders = new Headers();
		myHeaders.append("Authorization", "Bearer "+_atk);
		myHeaders.append("Content-Type", "application/json");

		var raw = JSON.stringify({
		  "pde": _pde,
		  "urlrecord": acceptURL,
		  "ipaddress": _ipd
		});

		var requestOptions = {
		  method: 'POST',
		  headers: myHeaders,
		  body: raw,
		  redirect: 'follow'
		};

		 
		fetch("URL/cookie", requestOptions)
		  .then(response => response.text())
		  .then(result => {})
		  .catch(error => console.log('error', error));
			
	}
}

function getDCHECKTOKEN(){
	let today = new Date();
	let month = (today.getMonth()+1).toString();
	if(month.length == 1){
		month = "0"+month;
	}
	let todayDay = (today.getDate()).toString();
	if(todayDay.length == 1){
		todayDay = "0"+todayDay;
	}

	let date = today.getFullYear()+'-'+month+'-'+todayDay;
	
	var myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");
	myHeaders.append("Cookie", "ci_session_patient=50ch8gl4ekgehe5g6m0cj4d517v3p03h");

	var raw = JSON.stringify({
	  "username": "TokenRJH",
	  "password": date
	});

	var requestOptions = {
	  method: 'POST',
	  headers: myHeaders,
	  body: raw,
	  redirect: 'follow'
	};

	 fetch("URL", requestOptions)
	.then(response => response.text())
	.then(result => {
		const obj = JSON.parse(result);
		setCookie("_atk", obj.Token, 1);
	})
	.catch(error => console.log('error', error));
	  
}

function getIP(){
	
	var requestOptions = {
		method: 'POST',
		redirect: 'follow'
	};

	fetch("https://www.cloudflare.com/cdn-cgi/trace", requestOptions)
	.then(response => response.text())
	.then(result => {
		data = result.trim().split('\n').reduce(function(obj, pair) {
			pair = pair.split('=');
			return obj[pair[0]] = pair[1], obj;
		}, {});
		setCookie("_ipd", data.ip, 1);
		return data.ip;
	})
	.catch(error => console.log('error', error));
  

	
}



	