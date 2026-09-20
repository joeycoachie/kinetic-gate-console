(function () {
  function safeString(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'function') return value.name || 'function';
    return JSON.stringify(value);
  }

  function evalExpr(expr, ctx, component) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) return '';

    try {
      const source = 'with (ctx) { return (' + trimmed + '); }';
      const fn = new Function('ctx', 'component', source);
      return fn(ctx, component);
    } catch (error) {
      console.warn('DC expression failed:', trimmed, error);
      return '';
    }
  }

  function renderTemplate(template, ctx, component) {
    let out = template || '';

    component.__callbacks = component.__callbacks || {};
    component.__callbackSeq = component.__callbackSeq || 0;

    out = out.replace(/(on[A-Za-z]+)="\{\{\s*([^}]+?)\s*\}\}"/g, (_, attrName, expr) => {
      const fn = evalExpr(expr, ctx, component);
      if (typeof fn === 'function') {
        const id = '__dc_' + (++component.__callbackSeq);
        component.__callbacks[id] = fn.bind(component);
        return `data-dc-event="${id}"`;
      }

      if (typeof fn === 'string' && typeof component[fn] === 'function') {
        const id = '__dc_' + (++component.__callbackSeq);
        component.__callbacks[id] = component[fn].bind(component);
        return `data-dc-event="${id}"`;
      }

      return '';
    });

    out = out.replace(/<sc-if\s+value="\{\{\s*([^}]+?)\s*\}\}"[^>]*>([\s\S]*?)<\/sc-if>/g, (_, expr, inner) => {
      const ok = !!evalExpr(expr, ctx, component);
      return ok ? renderTemplate(inner, ctx, component) : '';
    });

    out = out.replace(/<sc-for\s+list="\{\{\s*([^}]+?)\s*\}\}"\s+as="([A-Za-z0-9_]+)"[^>]*>([\s\S]*?)<\/sc-for>/g, (_, expr, name, inner) => {
      const list = evalExpr(expr, ctx, component);
      if (!Array.isArray(list)) return '';
      return list.map((item, index) => {
        const localCtx = { ...ctx, [name]: item, [`${name}Index`]: index };
        return renderTemplate(inner, localCtx, component);
      }).join('');
    });

    out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
      const value = evalExpr(expr, ctx, component);
      return safeString(value);
    });

    return out;
  }

  function bindEventHandlers(root, component) {
    if (!root) return;
    const all = root.querySelectorAll('*');
    for (const node of all) {
      const eventId = node.getAttribute('data-dc-event');
      if (!eventId) continue;
      const callback = component.__callbacks && component.__callbacks[eventId];
      if (typeof callback !== 'function') continue;

      const eventName = node.dataset.dcEventName || 'click';
      node.removeAttribute('data-dc-event');
      node.removeAttribute('data-dc-event-name');
      node.addEventListener(eventName, (event) => callback.call(component, event));
    }
  }

  class DCLogic {
    constructor(props = {}) {
      this.props = props || {};
      this.state = {};
      this.root = null;
      this.__template = '';
      this.__callbacks = {};
      this.__callbackSeq = 0;
    }

    setState(next) {
      const patch = typeof next === 'function' ? next(this.state) : next;
      this.state = { ...this.state, ...patch };
      if (this.root) this.render();
    }

    render() {
      if (!this.root) return;
      const context = {
        ...this.props,
        ...this.state,
        ...(typeof this.renderVals === 'function' ? this.renderVals() : {})
      };
      this.root.innerHTML = renderTemplate(this.__template, context, this);
      bindEventHandlers(this.root, this);
    }
  }

  DCLogic.renderDocument = function (html, mountEl) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;

    const xdc = wrapper.querySelector('x-dc');
    const scriptTag = wrapper.querySelector('script[data-dc-script]');
    if (!xdc || !scriptTag) {
      throw new Error('No <x-dc> block or data-dc-script block found in document');
    }

    const scriptText = scriptTag.textContent || '';
    const rawProps = scriptTag.getAttribute('data-props') || '{}';
    let parsedProps = {};
    try {
      parsedProps = JSON.parse(rawProps);
    } catch (error) {
      parsedProps = {};
    }

    const Component = new Function('DCLogic', `${scriptText}; return Component;`)(DCLogic);
    const instance = new Component(parsedProps);
    const host = document.createElement('div');
    host.className = 'dc-host';
    mountEl.innerHTML = '';
    mountEl.appendChild(host);

    instance.root = host;
    instance.__template = xdc.innerHTML.trim();
    instance.render();

    if (typeof instance.componentDidMount === 'function') {
      instance.componentDidMount();
    }

    return instance;
  };

  window.DCLogic = DCLogic;
})();
