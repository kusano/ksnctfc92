document.addEventListener('DOMContentLoaded', function() {
  var form = document.getElementById('form');
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/submit', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState==4 && xhr.status==200)
      {
        alert(xhr.responseText);
      }
    };
    xhr.send(JSON.stringify({
      problem: document.getElementById('problem').value,
      flag: document.getElementById('flag').value,
      _csrf: document.getElementById('_csrf').value,
    }));
  });
});
