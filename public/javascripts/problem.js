document.addEventListener('DOMContentLoaded', function() {
  var form = document.getElementById('form');
  var submit = document.getElementById('submit');
  var modal = document.getElementById('modal');
  var lastResult = '';

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    submit.classList.add('is-loading');
    setTimeout(() => {
      var xhr = new XMLHttpRequest();
      var flag = document.getElementById('flag').value;
      xhr.open('POST', '/submit', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onreadystatechange = () => {
        if (xhr.readyState==4)
        {
          submit.classList.remove('is-loading');
          if (xhr.status != 200)
            alert('error');
          else {
            var result = JSON.parse(xhr.responseText);
            for (var node of document.querySelectorAll('.correct, .wrong, .duplicate, .hidden'))
              node.style.display = 'none';
            for (var node of document.querySelectorAll('.'+result.result))
              node.style.display = '';
            document.getElementById('point').innerText = result.point;
            document.getElementById('flag_modal').innerText = flag;
            lastResult = result.result;
            modal.classList.add('is-active');
          }
        }
      };
      xhr.send(JSON.stringify({
        problem: document.getElementById('problem').value,
        flag: flag,
        _csrf: document.getElementById('_csrf').value,
      }));
    }, 500);
  });

  function closeModal(e)
  {
    e.preventDefault();
    modal.classList.remove('is-active');
    if (lastResult == 'correct')
      location.reload();
  }
  document.getElementById('modal-background').addEventListener('click', closeModal);
  document.getElementById('modal-ok').addEventListener('click', closeModal);
});
