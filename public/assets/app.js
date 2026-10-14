// Landing page behaviour: button beacons, the waitlist form, the share link and the cookie choice.
// On the static demo (data-mode="demo") nothing is sent anywhere.
(function () {
  'use strict';

  var body = document.body;
  var view = body.dataset.view || '';
  var demo = body.dataset.mode === 'demo';

  function post(path, payload) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    });
  }

  function demoNote(text) {
    var note = document.getElementById('demo-note');
    if (note) note.textContent = text;
  }

  // Button presses. sendBeacon survives the page scrolling or closing; fetch is the fallback.
  function track(type) {
    if (demo || !view) return;
    var payload = JSON.stringify({ type: type, view: view });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/event', payload)) return;
    } catch (e) {
      // fall through to fetch
    }
    fetch('/api/event', { method: 'POST', body: payload, keepalive: true, credentials: 'same-origin' }).catch(function () {});
  }

  document.querySelectorAll('[data-track]').forEach(function (el) {
    el.addEventListener('click', function () {
      track(el.dataset.track);
    });
  });

  document.querySelectorAll('[data-demo-note]').forEach(function (el) {
    el.addEventListener('click', function (event) {
      event.preventDefault();
      demoNote(el.dataset.demoNote);
    });
  });

  // Waitlist form
  var form = document.getElementById('signup');
  if (form) {
    // The page ships the button disabled, so without this script the form cannot be sent at all.
    // A form sent without it would still post the address in the request body, never in the URL.
    var submit = form.querySelector('button[type="submit"]');
    submit.disabled = false;
    var slots = {};
    form.querySelectorAll('[data-error-for]').forEach(function (el) {
      slots[el.dataset.errorFor] = el;
    });
    var fields = {
      email: form.querySelector('#f-email'),
      name: form.querySelector('#f-name'),
      consent: form.querySelector('#f-consent'),
    };

    var showErrors = function (errors) {
      Object.keys(slots).forEach(function (key) {
        slots[key].textContent = errors[key] || '';
      });
      Object.keys(fields).forEach(function (key) {
        if (fields[key]) fields[key].setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
      });
      var firstKey = ['email', 'name', 'answer', 'consent'].find(function (key) {
        return errors[key];
      });
      if (firstKey === 'answer') {
        var radio = form.querySelector('input[name="answer"]');
        if (radio) radio.focus();
      } else if (firstKey && fields[firstKey]) {
        fields[firstKey].focus();
      }
    };

    var checkLocally = function (payload, answerRequired) {
      var errors = {};
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) {
        errors.email = 'Enter an email address, such as name@example.com.';
      }
      if (answerRequired && !payload.answer) errors.answer = 'Choose one of the options.';
      if (!payload.consent) errors.consent = 'Tick the box to agree, so we can email you.';
      return errors;
    };

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var answerInput = form.querySelector('input[name="answer"]');
      var payload = {
        email: String(data.get('email') || '').trim(),
        name: String(data.get('name') || '').trim(),
        answer: String(data.get('answer') || ''),
        consent: data.get('consent') === 'on',
        website: String(data.get('website') || ''),
        view: view,
        variant: body.dataset.variant,
        src: body.dataset.src,
      };
      var errors = checkLocally(payload, Boolean(answerInput && answerInput.required));
      showErrors(errors);
      if (Object.keys(errors).length) return;

      if (demo) {
        demoNote('Demo: the form checked your input and sent nothing.');
        showThanks();
        return;
      }

      submit.disabled = true;
      post('/api/signup', payload)
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (out) {
              if (res.ok && out.ok) return showThanks();
              if (out.errors) return showErrors(out.errors);
              showErrors({ form: out.error || 'Something went wrong. Please try again.' });
            });
        })
        .catch(function () {
          showErrors({ form: 'Could not reach the server. Check your connection and try again.' });
        })
        .finally(function () {
          submit.disabled = false;
        });
    });
  }

  function showThanks() {
    document.getElementById('join-form-wrap').hidden = true;
    var thanks = document.getElementById('thanks');
    thanks.hidden = false;
    var title = document.getElementById('thanks-title');
    if (title) title.focus();
  }

  // Share link
  var shareInput = document.getElementById('share-url');
  var copyButton = document.getElementById('copy-link');
  var copyStatus = document.getElementById('copy-status');
  if (copyButton && shareInput) {
    copyButton.addEventListener('click', function () {
      track('share_click');
      var done = function () {
        copyStatus.textContent = 'Link copied.';
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareInput.value).then(done, function () {
          shareInput.select();
          copyStatus.textContent = 'Press Ctrl+C or Cmd+C to copy the selected link.';
        });
      } else {
        shareInput.select();
        copyStatus.textContent = 'Press Ctrl+C or Cmd+C to copy the selected link.';
      }
    });
  }
  var nativeShare = document.getElementById('native-share');
  if (nativeShare && navigator.share) {
    nativeShare.hidden = false;
    nativeShare.addEventListener('click', function () {
      track('share_click');
      navigator.share({ title: document.title, url: shareInput.value }).catch(function () {});
    });
  }

  // Cookie choice (privacy.stickiness = "consent"). Without JavaScript the form posts normally.
  var consent = document.querySelector('.consent form');
  if (consent) {
    consent.addEventListener('submit', function (event) {
      event.preventDefault();
      var choice = event.submitter ? event.submitter.value : 'decline';
      var variant = consent.querySelector('input[name="variant"]').value;
      var banner = consent.parentElement;
      post('/api/consent', { choice: choice, variant: variant })
        .catch(function () {})
        .finally(function () {
          banner.remove();
        });
    });
  }
})();
