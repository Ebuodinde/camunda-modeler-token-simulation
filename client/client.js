/**
 * Camunda Modeler v4.7 Plugin — BPMN 2.0 Token Simulation & Schema Validation
 *
 * Capabilities:
 *  - Two-phase discrete-event token synchronization (zero frame-rate clock drift)
 *  - Strict SequenceFlow, MessageFlow, and Association separation
 *  - Exclusive (XOR) Split & First-Wins Blocking XOR Join semantics
 *  - Parallel (AND) Split, Synchronisation Join, and Structural Deadlock detection
 *  - Inclusive (OR) Split, Default ('/') Flow, and Upstream-Reachability OR Join
 *  - Attached Interrupting & Non-Interrupting Boundary Events and Timer Events
 *  - Hierarchical Expanded Sub-Process execution and Multi-Pool Message Flows
 */
(function() {
  'use strict';

  function getBusinessObject(el) {
    return (el && el.businessObject) ? el.businessObject : el;
  }

  function isType(el, typeName) {
    var bo = getBusinessObject(el);
    return Boolean(bo && bo.$type === typeName);
  }

  function isActivity(el) {
    var bo = getBusinessObject(el);
    if (!bo || !bo.$type) return false;
    return (
      bo.$type === 'bpmn:Task' ||
      bo.$type === 'bpmn:UserTask' ||
      bo.$type === 'bpmn:ServiceTask' ||
      bo.$type === 'bpmn:ManualTask' ||
      bo.$type === 'bpmn:SendTask' ||
      bo.$type === 'bpmn:ReceiveTask' ||
      bo.$type === 'bpmn:ScriptTask' ||
      bo.$type === 'bpmn:BusinessRuleTask' ||
      bo.$type === 'bpmn:SubProcess' ||
      bo.$type === 'bpmn:CallActivity'
    );
  }

  function isGateway(el) {
    var bo = getBusinessObject(el);
    if (!bo || !bo.$type) return false;
    return bo.$type.indexOf('Gateway') !== -1;
  }

  function isStartEvent(el) {
    return isType(el, 'bpmn:StartEvent');
  }

  function isEndEvent(el) {
    return isType(el, 'bpmn:EndEvent');
  }

  function isIntermediateCatchEvent(el) {
    return isType(el, 'bpmn:IntermediateCatchEvent');
  }

  function isIntermediateThrowEvent(el) {
    return isType(el, 'bpmn:IntermediateThrowEvent');
  }

  function isBoundaryEvent(el) {
    return isType(el, 'bpmn:BoundaryEvent');
  }

  function hasEventDefinition(el, defType) {
    var bo = getBusinessObject(el);
    if (!bo || !bo.eventDefinitions || !bo.eventDefinitions.length) return false;
    return bo.eventDefinitions.some(function(d) {
      return d && d.$type === defType;
    });
  }

  function getDefaultFlowId(gw) {
    var bo = getBusinessObject(gw);
    if (!bo || !bo['default']) return null;
    return typeof bo['default'] === 'string' ? bo['default'] : bo['default'].id;
  }

  function getSequenceOutgoing(el) {
    var outs = (el && el.outgoing) ? el.outgoing : [];
    return outs.filter(function(c) { return isType(c, 'bpmn:SequenceFlow'); });
  }

  function getSequenceIncoming(el) {
    var incs = (el && el.incoming) ? el.incoming : [];
    return incs.filter(function(c) { return isType(c, 'bpmn:SequenceFlow'); });
  }

  function getMessageOutgoing(el) {
    var outs = (el && el.outgoing) ? el.outgoing : [];
    return outs.filter(function(c) { return isType(c, 'bpmn:MessageFlow'); });
  }

  function getMessageIncoming(el) {
    var incs = (el && el.incoming) ? el.incoming : [];
    return incs.filter(function(c) { return isType(c, 'bpmn:MessageFlow'); });
  }

  function parseMinutesFromText(txt) {
    if (!txt) return null;
    var hm = String(txt).match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/i);
    if (hm) return parseFloat(hm[1]) * 60;
    var mm = String(txt).match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|m)\b/i);
    if (mm) return parseFloat(mm[1]);
    return null;
  }

  function getElementCenter(el) {
    return {
      x: (el.x || 0) + (el.width || 0) / 2,
      y: (el.y || 0) + (el.height || 0) / 2
    };
  }

  function getPointAtProgress(waypoints, progress) {
    if (!waypoints || !waypoints.length) return { x: 0, y: 0 };
    if (waypoints.length === 1) return { x: waypoints[0].x, y: waypoints[0].y };
    var p = Math.max(0, Math.min(1, progress));
    var totalLen = 0;
    var segLens = [];
    for (var i = 0; i < waypoints.length - 1; i++) {
      var dx = waypoints[i + 1].x - waypoints[i].x;
      var dy = waypoints[i + 1].y - waypoints[i].y;
      var len = Math.sqrt(dx * dx + dy * dy);
      segLens.push(len);
      totalLen += len;
    }
    if (totalLen <= 0.001) return { x: waypoints[0].x, y: waypoints[0].y };
    var targetDist = totalLen * p;
    var acc = 0;
    for (var j = 0; j < segLens.length; j++) {
      var seg = segLens[j];
      var p0 = waypoints[j];
      var p1 = waypoints[j + 1];
      if (acc + seg >= targetDist || j === waypoints.length - 2) {
        var localT = seg > 0 ? (targetDist - acc) / seg : 0;
        return {
          x: p0.x + (p1.x - p0.x) * localT,
          y: p0.y + (p1.y - p0.y) * localT
        };
      }
      acc += seg;
    }
    var last = waypoints[waypoints.length - 1];
    return { x: last.x, y: last.y };
  }

  function getFlowMidpoint(flow) {
    return getPointAtProgress(flow.waypoints || [], 0.45);
  }

  function getFlowBBoxOrigin(flow) {
    var wps = (flow && flow.waypoints) || [];
    if (!wps.length) return { x: flow.x || 0, y: flow.y || 0 };
    var minX = wps[0].x;
    var minY = wps[0].y;
    for (var i = 1; i < wps.length; i++) {
      if (wps[i].x < minX) minX = wps[i].x;
      if (wps[i].y < minY) minY = wps[i].y;
    }
    return { x: minX, y: minY };
  }

  function BpmnTokenSimulationService(eventBus, canvas, elementRegistry, overlays, injector) {
    if (typeof window !== 'undefined') {
      window.__bpmnSimInstance = this;
    }
    this.eventBus = eventBus;
    this.canvas = canvas;
    this.elementRegistry = elementRegistry;
    this.overlays = overlays;
    this.injector = injector;

    this.simActive = (typeof document === 'undefined');
    this.running = false;
    this.paused = false;
    this.speedMultiplier = 1.0;
    this.simMinutes = 0;
    this.minutesPerRealSecond = 7.5;
    this.tokens = [];
    this.nextTokenId = 1;
    this.nextEventGroupId = 1;

    // Gateway, Loop & Event configurations
    this.xorSelectedFlowId = {};          // gatewayId -> sequenceFlowId
    this.orSelectedFlowIds = {};          // gatewayId -> { flowId: boolean }
    this.detectedLoops = {};              // gatewayId -> { backFlowId, exitFlowId }
    this.loopReworkFlowId = {};           // gatewayId -> backFlowId
    this.loopMaxIterations = {};          // gatewayId -> max rework iterations before switching to exit
    this.eventGatewayManualOverride = {}; // gatewayId -> boolean
    this.xorVisitCounts = {};             // gatewayId -> visit count during current run
    this.customDwellMinutes = {};         // elementId -> minutes
    this.gatewayWaitQueues = {};          // gatewayId -> { flowId: [token] }
    this.xorJoinWinnerFlow = {};          // gatewayId -> winning flowId (First-Wins Blocking Rule)
    this.xorJoinBlockedFlows = {};        // gatewayId -> { flowId: true }
    this.deadlockedGateways = {};         // gatewayId -> true
    this.pendingMessages = {};            // targetElementId -> buffered message count
    this.reachedEndEvents = {};           // endEventId -> count

    this.overlayIds = [];
    this.svgLayer = null;
    this.rafId = null;
    this.lastFrameTime = null;

    this._initUI();
    this._bindEvents();
    if (typeof window !== 'undefined') {
      window.bpmnTokenSim = this;
    }
  }

  BpmnTokenSimulationService.$inject = [
    'eventBus',
    'canvas',
    'elementRegistry',
    'overlays',
    'injector'
  ];

  BpmnTokenSimulationService.prototype._announceStatus = function(msg) {
    if (this.srStatusEl && msg) {
      this.srStatusEl.textContent = msg;
    }
  };

  BpmnTokenSimulationService.prototype._initUI = function() {
    var self = this;
    if (typeof document === 'undefined') return;
    var container = this.canvas && this.canvas.getContainer ? this.canvas.getContainer() : null;
    if (!container) return;
    container.style.position = 'relative';

    // Accessible Top Simulation & Validation Toolbar (role="toolbar" + roving tabindex fallback)
    var toolbar = document.createElement('div');
    toolbar.className = 'bpmn-sim-sim-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('focusgroup', 'toolbar wrap');
    toolbar.setAttribute('aria-label', 'Token Simulation and Schema Validation');
    toolbar.innerHTML = [
      '<div class="bpmn-sim-sim-group" role="group" aria-label="Mode and Validation">',
      '  <button type="button" class="bpmn-sim-sim-btn" data-action="toggle-mode" aria-pressed="false" title="Toggle Token Simulation mode">',
      '    ▶ Token Simulation',
      '  </button>',
      '  <button type="button" class="bpmn-sim-sim-btn" data-action="validate-schema" title="Validate BPMN 2.0 grammar, pools, message flows, and deadlocks">',
      '    ✓ Validate',
      '  </button>',
      '</div>',
      '<span class="bpmn-sim-sim-sep" data-role="playback-sep" role="separator" aria-orientation="vertical" style="display:none;"></span>',
      '<div class="bpmn-sim-sim-group" data-role="playback-controls" role="group" aria-label="Playback Controls" style="display:none;">',
      '  <button type="button" class="bpmn-sim-sim-btn bpmn-sim-sim-btn-primary" data-action="start-sim" title="Spawn token at Start Event and run">',
      '    ▶ Run',
      '  </button>',
      '  <button type="button" class="bpmn-sim-sim-btn" data-action="pause-sim" aria-pressed="false" title="Pause or resume simulation">',
      '    ⏸ Pause',
      '  </button>',
      '  <button type="button" class="bpmn-sim-sim-btn" data-action="step-sim" title="Advance simulation by +5 minutes">',
      '    ⏭ Step (+5m)',
      '  </button>',
      '  <button type="button" class="bpmn-sim-sim-btn" data-action="reset-sim" title="Reset tokens and gateway states">',
      '    ↺ Reset',
      '  </button>',
      '  <select class="bpmn-sim-sim-select" data-action="speed-select" aria-label="Simulation Speed" title="Simulation speed">',
      '    <option value="0.5">0.5x</option>',
      '    <option value="0.75">0.75x</option>',
      '    <option value="1" selected>1.0x</option>',
      '    <option value="1.5">1.5x</option>',
      '    <option value="2.5">2.5x</option>',
      '  </select>',
      '  <div class="bpmn-sim-sim-clock" data-role="clock" title="Simulated process clock">',
      '    ⏱ 0 min',
      '  </div>',
      '</div>'
    ].join('');

    container.appendChild(toolbar);
    this.toolbar = toolbar;

    // Roving tabindex fallback for browsers without native focusgroup
    if (typeof HTMLElement !== 'undefined' && !('focusGroup' in HTMLElement.prototype)) {
      var getVisibleItems = function() {
        return Array.prototype.slice.call(toolbar.querySelectorAll('button, select')).filter(function(el) {
          return el.offsetParent !== null;
        });
      };
      var allInit = Array.prototype.slice.call(toolbar.querySelectorAll('button, select'));
      allInit.forEach(function(el, idx) { el.tabIndex = idx === 0 ? 0 : -1; });
      toolbar.addEventListener('focusin', function(ev) {
        var vis = getVisibleItems();
        if (vis.indexOf(ev.target) !== -1) {
          vis.forEach(function(el) { el.tabIndex = el === ev.target ? 0 : -1; });
        }
      });
      toolbar.addEventListener('keydown', function(ev) {
        if (ev.target && ev.target.tagName === 'SELECT' && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
          return;
        }
        var tbItems = getVisibleItems();
        var currIdx = tbItems.indexOf(ev.target);
        if (currIdx === -1) return;
        var rtl = typeof getComputedStyle === 'function' && getComputedStyle(toolbar).direction === 'rtl';
        var fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
        var bwd = rtl ? 'ArrowRight' : 'ArrowLeft';
        var nextIdx = -1;
        if (ev.key === fwd) nextIdx = (currIdx + 1) % tbItems.length;
        else if (ev.key === bwd) nextIdx = (currIdx - 1 + tbItems.length) % tbItems.length;
        else if (ev.key === 'Home') nextIdx = 0;
        else if (ev.key === 'End') nextIdx = tbItems.length - 1;
        if (nextIdx !== -1) {
          ev.preventDefault();
          tbItems[nextIdx].focus();
        }
      });
    }

    // Live region outside toolbar for screen-reader confirmation
    var srStatus = document.createElement('p');
    srStatus.setAttribute('role', 'status');
    srStatus.className = 'bpmn-sim-sr-status';
    container.appendChild(srStatus);
    this.srStatusEl = srStatus;

    // Clean Token Simulation Event Inspector (Bottom-Right, Collapsible & Click-Through)
    var calloutWrap = document.createElement('div');
    calloutWrap.className = 'bpmn-sim-inspector-wrap';
    calloutWrap.innerHTML = [
      '<div class="bpmn-sim-inspector-primary" data-role="primary-box">',
      '  <div class="bpmn-sim-inspector-header">',
      '    <span>Token Simulation</span>',
      '    <span style="display:inline-flex; align-items:center; gap:6px;">',
      '      <span data-role="ref-badge">BPMN 2.0</span>',
      '      <button type="button" class="bpmn-sim-callout-toggle" data-action="collapse-callout" aria-expanded="true" title="Minimize or expand simulation details">—</button>',
      '    </span>',
      '  </div>',
      '  <div data-role="primary-text">Click "▶ Run" (or "▶" above a Start Event) to simulate token flow across the diagram.</div>',
      '</div>',
      '<div class="bpmn-sim-inspector-secondary" data-role="secondary-box">',
      '  <div data-role="secondary-text">Click gateway branch pills to select active paths, or click activity badges to adjust durations.</div>',
      '</div>'
    ].join('');
    container.appendChild(calloutWrap);
    this.calloutWrap = calloutWrap;

    var collapseBtn = calloutWrap.querySelector('[data-action="collapse-callout"]');
    collapseBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var isCollapsed = calloutWrap.classList.toggle('collapsed');
      collapseBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      collapseBtn.textContent = isCollapsed ? '+' : '—';
    });

    // Validation Drawer
    var valPanel = document.createElement('div');
    valPanel.className = 'bpmn-sim-validation-panel';
    valPanel.style.display = 'none';
    container.appendChild(valPanel);
    this.valPanel = valPanel;

    var toggleBtn = toolbar.querySelector('[data-action="toggle-mode"]');
    var playbackSep = toolbar.querySelector('[data-role="playback-sep"]');
    var playbackGroup = toolbar.querySelector('[data-role="playback-controls"]');

    this._setSimMode = function(enable) {
      self.simActive = Boolean(enable);
      toggleBtn.setAttribute('aria-pressed', self.simActive ? 'true' : 'false');
      if (playbackSep) playbackSep.style.display = self.simActive ? 'inline-block' : 'none';
      playbackGroup.style.display = self.simActive ? 'inline-flex' : 'none';
      self.calloutWrap.style.display = self.simActive ? 'flex' : 'none';
      if (self.simActive) {
        self._detectDiagramContext();
        self._refreshGatewayOverlays();
        self._announceStatus('Token simulation enabled');
      } else {
        self.resetSimulation();
        self._clearOverlays();
        self._announceStatus('Token simulation disabled');
      }
    };

    toggleBtn.addEventListener('click', function() {
      self._setSimMode(!self.simActive);
    });

    toolbar.querySelector('[data-action="start-sim"]').addEventListener('click', function() {
      if (!self.simActive) self._setSimMode(true);
      self.startSimulation();
    });

    toolbar.querySelector('[data-action="pause-sim"]').addEventListener('click', function() {
      self.togglePause();
    });

    toolbar.querySelector('[data-action="step-sim"]').addEventListener('click', function() {
      if (!self.simActive) self._setSimMode(true);
      self.stepSimulation(5);
    });

    toolbar.querySelector('[data-action="reset-sim"]').addEventListener('click', function() {
      self.resetSimulation();
      self._announceStatus('Simulation reset');
    });

    toolbar.querySelector('[data-action="speed-select"]').addEventListener('change', function(e) {
      self.speedMultiplier = parseFloat(e.target.value) || 1.0;
    });

    toolbar.querySelector('[data-action="validate-schema"]').addEventListener('click', function() {
      self.runSchemaValidation();
    });

  };

  BpmnTokenSimulationService.prototype._bindEvents = function() {
    var self = this;
    if (!this.eventBus) return;

    this.eventBus.on('import.done', function() {
      setTimeout(function() {
        self.resetSimulation();
        self._detectDiagramContext();
        self._refreshGatewayOverlays();
      }, 40);
    });

    this.eventBus.on(['shape.added', 'shape.removed', 'connection.added', 'connection.removed', 'elements.changed'], function() {
      if (self.simActive && !self.running) {
        self._detectDiagramContext();
        self._refreshGatewayOverlays();
      }
    });
    // NOTE: We intentionally do NOT hijack `element.click` on StartEvents!
    // Clicking shapes on the canvas always opens Camunda Modeler's normal selection & Context Pad.
  };

  /**
   * Scope & Hierarchy Helpers (SubProcess & Pool / Participant resolution)
   */
  BpmnTokenSimulationService.prototype._getParentElement = function(el) {
    if (!el) return null;
    if (el.parent) return el.parent;
    var bo = getBusinessObject(el);
    if (bo && bo.$parent && bo.$parent.id && this.elementRegistry) {
      return this.elementRegistry.get(bo.$parent.id);
    }
    return null;
  };

  BpmnTokenSimulationService.prototype._getEnclosingSubProcess = function(el) {
    var curr = this._getParentElement(el);
    var guard = 0;
    while (curr && guard++ < 20) {
      if (isType(curr, 'bpmn:SubProcess')) return curr;
      curr = this._getParentElement(curr);
    }
    return null;
  };

  BpmnTokenSimulationService.prototype._getEnclosingPoolId = function(el) {
    var curr = el;
    var guard = 0;
    while (curr && guard++ < 25) {
      if (isType(curr, 'bpmn:Participant')) return curr.id;
      if (isType(curr, 'bpmn:Process')) {
        var procId = curr.id;
        var foundPart = null;
        if (this.elementRegistry) {
          this.elementRegistry.getAll().forEach(function(item) {
            var pBo = getBusinessObject(item);
            if (pBo && pBo.$type === 'bpmn:Participant' && pBo.processRef &&
                (pBo.processRef === procId || pBo.processRef.id === procId)) {
              foundPart = item.id;
            }
          });
        }
        return foundPart || procId;
      }
      curr = this._getParentElement(curr);
    }
    return 'default_pool';
  };

  BpmnTokenSimulationService.prototype._getSubProcessChildStarts = function(subEl) {
    var self = this;
    if (!subEl || !isType(subEl, 'bpmn:SubProcess') || !this.elementRegistry) return [];
    return this.elementRegistry.filter(function(e) {
      if (!isStartEvent(e)) return false;
      var enc = self._getEnclosingSubProcess(e);
      return Boolean(enc && enc.id === subEl.id);
    });
  };

  BpmnTokenSimulationService.prototype._isExpandedSubProcess = function(el) {
    return isType(el, 'bpmn:SubProcess') && this._getSubProcessChildStarts(el).length > 0;
  };

  BpmnTokenSimulationService.prototype._isInstantiableRootStartEvent = function(el) {
    if (!isStartEvent(el)) return false;
    // 1. Never auto-spawn StartEvents nested inside a SubProcess at t=0
    if (this._getEnclosingSubProcess(el)) return false;
    // 2. If this StartEvent receives an incoming MessageFlow from another Pool, wait for that message!
    if (getMessageIncoming(el).length > 0) return false;
    return true;
  };

  BpmnTokenSimulationService.prototype._getAttachedBoundaryEvents = function(actEl) {
    if (!actEl || !this.elementRegistry) return [];
    var seen = {};
    var result = [];
    var addB = function(b) {
      if (!b || !isBoundaryEvent(b) || seen[b.id]) return;
      // Ignore Compensation boundary events (no outgoing sequence flows; used for rollback associations)
      if (hasEventDefinition(b, 'bpmn:CompensateEventDefinition')) return;
      if (getSequenceOutgoing(b).length === 0) return;
      seen[b.id] = true;
      result.push(b);
    };
    if (actEl.attachers && actEl.attachers.length) {
      actEl.attachers.forEach(addB);
    }
    this.elementRegistry.getAll().forEach(function(item) {
      if (!isBoundaryEvent(item)) return;
      var bo = getBusinessObject(item);
      var refId = bo && bo.attachedToRef ? (typeof bo.attachedToRef === 'string' ? bo.attachedToRef : bo.attachedToRef.id) : null;
      if (refId === actEl.id) addB(item);
    });
    return result;
  };

  BpmnTokenSimulationService.prototype._isCompensationActivity = function(actEl) {
    var bo = getBusinessObject(actEl);
    if (bo && bo.isForCompensation) return true;
    if (!this.elementRegistry) return false;
    var all = this.elementRegistry.getAll();
    for (var i = 0; i < all.length; i++) {
      var cBo = getBusinessObject(all[i]);
      if (cBo && cBo.$type === 'bpmn:Association') {
        var sId = cBo.sourceRef && (typeof cBo.sourceRef === 'string' ? cBo.sourceRef : cBo.sourceRef.id);
        var tId = cBo.targetRef && (typeof cBo.targetRef === 'string' ? cBo.targetRef : cBo.targetRef.id);
        if (tId === actEl.id && sId) {
          var srcEl = this.elementRegistry.get(sId);
          if (srcEl && isBoundaryEvent(srcEl) && hasEventDefinition(srcEl, 'bpmn:CompensateEventDefinition')) {
            return true;
          }
        }
      }
    }
    return false;
  };

  BpmnTokenSimulationService.prototype.applyPresetConfig = function(preset) {
    this.xorSelectedFlowId = {};
    this.orSelectedFlowIds = {};
    this.loopMaxIterations = {};
    this.loopReworkFlowId = {};
    this.eventGatewayManualOverride = {};
    if (!preset) return;
    if (preset.xorSelectedFlowId) {
      Object.keys(preset.xorSelectedFlowId).forEach(function(k) {
        this.xorSelectedFlowId[k] = preset.xorSelectedFlowId[k];
      }, this);
    }
    if (preset.orSelectedFlowIds) {
      Object.keys(preset.orSelectedFlowIds).forEach(function(k) {
        this.orSelectedFlowIds[k] = Object.assign({}, preset.orSelectedFlowIds[k]);
      }, this);
    }
    if (preset.loopMaxIterations) {
      Object.keys(preset.loopMaxIterations).forEach(function(k) {
        this.loopMaxIterations[k] = preset.loopMaxIterations[k];
        if (preset.xorSelectedFlowId && preset.xorSelectedFlowId[k]) {
          this.loopReworkFlowId[k] = preset.xorSelectedFlowId[k];
        }
      }, this);
    }
  };

  /**
   * Graph helper (SequenceFlows only!): Can `startNode` reach `targetNodeId` without passing through `forbiddenNodeId`?
   */
  BpmnTokenSimulationService.prototype._canNodeReachTarget = function(startNode, targetNodeId, forbiddenNodeId) {
    if (!startNode) return false;
    if (startNode.id === targetNodeId) return true;
    var visited = {};
    var queue = [startNode];
    visited[startNode.id] = true;
    while (queue.length > 0) {
      var curr = queue.shift();
      if (!curr) continue;
      if (forbiddenNodeId && curr.id === forbiddenNodeId) continue;
      var outs = getSequenceOutgoing(curr);
      for (var i = 0; i < outs.length; i++) {
        var nxt = outs[i].target;
        if (!nxt) continue;
        if (nxt.id === targetNodeId) return true;
        if (forbiddenNodeId && nxt.id === forbiddenNodeId) continue;
        if (!visited[nxt.id]) {
          visited[nxt.id] = true;
          queue.push(nxt);
        }
      }
    }
    return false;
  };

  /**
   * Graph helper (SequenceFlows only!): Can `startNode` reach ANY `bpmn:EndEvent` without passing through `forbiddenNodeId`?
   */
  BpmnTokenSimulationService.prototype._canNodeReachAnyEndWithoutNode = function(startNode, forbiddenNodeId) {
    if (!startNode) return false;
    if (isEndEvent(startNode)) return true;
    var visited = {};
    var queue = [startNode];
    visited[startNode.id] = true;
    while (queue.length > 0) {
      var curr = queue.shift();
      if (!curr) continue;
      if (forbiddenNodeId && curr.id === forbiddenNodeId) continue;
      if (isEndEvent(curr)) return true;
      var outs = getSequenceOutgoing(curr);
      for (var i = 0; i < outs.length; i++) {
        var nxt = outs[i].target;
        if (!nxt) continue;
        if (forbiddenNodeId && nxt.id === forbiddenNodeId) continue;
        if (isEndEvent(nxt)) return true;
        if (!visited[nxt.id]) {
          visited[nxt.id] = true;
          queue.push(nxt);
        }
      }
    }
    return false;
  };

  BpmnTokenSimulationService.prototype._detectDiagramContext = function() {
    var self = this;
    if (!this.elementRegistry) return;
    this.detectedLoops = {};

    // Universal Topological Dominance Loop Detector:
    // For ANY ExclusiveGateway split, an outgoing sequence flow `f` is a pure rework/loopback edge
    // iff `f.target` can reach `gw` AND `f.target` CANNOT reach any EndEvent without passing through `gw`.
    var all = this.elementRegistry.getAll();
    all.forEach(function(el) {
      if (!isType(el, 'bpmn:ExclusiveGateway')) return;
      var outs = getSequenceOutgoing(el);
      if (outs.length < 2) return;

      var loopBackFlow = null;
      var loopExitFlow = null;
      for (var i = 0; i < outs.length; i++) {
        var f = outs[i];
        var reachesGwAgain = self._canNodeReachTarget(f.target, el.id, null);
        var reachesEndWithoutGw = self._canNodeReachAnyEndWithoutNode(f.target, el.id);
        if (reachesGwAgain && !reachesEndWithoutGw) {
          loopBackFlow = f;
        } else if (reachesEndWithoutGw) {
          loopExitFlow = f;
        }
      }

      if (loopBackFlow && loopExitFlow) {
        self.detectedLoops[el.id] = {
          backFlowId: loopBackFlow.id,
          exitFlowId: loopExitFlow.id
        };
        self.loopReworkFlowId[el.id] = loopBackFlow.id;
        if (!self.xorSelectedFlowId[el.id]) {
          self.xorSelectedFlowId[el.id] = loopBackFlow.id;
        }
        if (self.loopMaxIterations[el.id] === undefined) {
          self.loopMaxIterations[el.id] = 1;
        }
      }
    });
  };

  BpmnTokenSimulationService.prototype._ensureSvgLayer = function() {
    if (typeof document === 'undefined' || !this.canvas || !this.canvas._viewport) return null;
    var viewport = this.canvas._viewport;
    if (this.svgLayer && this.svgLayer.parentNode === viewport) {
      return this.svgLayer;
    }
    var existing = viewport.querySelector('.bpmn-sim-token-svg-layer');
    if (existing) {
      this.svgLayer = existing;
      return existing;
    }
    var ns = 'http://www.w3.org/2000/svg';
    var g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'bpmn-sim-token-svg-layer');
    viewport.appendChild(g);
    this.svgLayer = g;
    return g;
  };

  /**
   * Extracts duration (in minutes) from custom overrides, associated TextAnnotation, or element name.
   */
  BpmnTokenSimulationService.prototype._getElementExplicitMinutes = function(el) {
    if (!el) return null;
    if (this.customDwellMinutes[el.id] !== undefined) {
      return this.customDwellMinutes[el.id];
    }
    if (this.elementRegistry) {
      var all = this.elementRegistry.getAll();
      for (var i = 0; i < all.length; i++) {
        var item = all[i];
        var bo = getBusinessObject(item);
        if (bo && bo.$type === 'bpmn:Association') {
          var srcId = bo.sourceRef && (typeof bo.sourceRef === 'string' ? bo.sourceRef : bo.sourceRef.id);
          var tgtId = bo.targetRef && (typeof bo.targetRef === 'string' ? bo.targetRef : bo.targetRef.id);
          var annotEl = null;
          if (srcId === el.id && tgtId) annotEl = this.elementRegistry.get(tgtId);
          else if (tgtId === el.id && srcId) annotEl = this.elementRegistry.get(srcId);
          var annotBo = annotEl ? getBusinessObject(annotEl) : (srcId === el.id ? bo.targetRef : (tgtId === el.id ? bo.sourceRef : null));
          if (annotBo && annotBo.$type === 'bpmn:TextAnnotation' && annotBo.text) {
            var parsed = parseMinutesFromText(annotBo.text);
            if (parsed !== null) return parsed;
          }
        }
      }
    }
    var elBo = getBusinessObject(el);
    if (elBo && elBo.name) {
      var fromName = parseMinutesFromText(elBo.name);
      if (fromName !== null) return fromName;
    }
    return null;
  };

  BpmnTokenSimulationService.prototype._getActivityDwellMinutes = function(el) {
    var explicit = this._getElementExplicitMinutes(el);
    return explicit !== null ? explicit : 15;
  };

  BpmnTokenSimulationService.prototype._isDynamicEventRaceGateway = function(gw) {
    if (!isType(gw, 'bpmn:EventBasedGateway')) return false;
    if (this.eventGatewayManualOverride[gw.id]) return false;
    var outs = getSequenceOutgoing(gw);
    if (outs.length < 2) return false;
    var self = this;
    return outs.some(function(f) {
      var tgt = f.target;
      if (!tgt) return false;
      if (getMessageIncoming(tgt).length > 0) return true;
      if (hasEventDefinition(tgt, 'bpmn:TimerEventDefinition')) return true;
      if (isIntermediateCatchEvent(tgt) && self._getElementExplicitMinutes(tgt) !== null) return true;
      return false;
    });
  };

  BpmnTokenSimulationService.prototype._ensureGatewaySelections = function(gw) {
    var outgoing = getSequenceOutgoing(gw);
    if (outgoing.length <= 1) return;
    var defaultFlowId = getDefaultFlowId(gw);

    if (isType(gw, 'bpmn:ExclusiveGateway') || isType(gw, 'bpmn:EventBasedGateway')) {
      var current = this.xorSelectedFlowId[gw.id];
      var valid = outgoing.some(function(f) { return f.id === current; });
      if (!valid) {
        var preferred = outgoing[0];
        for (var i = 0; i < outgoing.length; i++) {
          var name = (getBusinessObject(outgoing[i]).name || '').toUpperCase();
          if (
            name.indexOf('TRUE') !== -1 ||
            name.indexOf('YES') !== -1 ||
            name.indexOf('2A') !== -1 ||
            name.indexOf('1ST') !== -1
          ) {
            preferred = outgoing[i];
            break;
          }
        }
        this.xorSelectedFlowId[gw.id] = preferred.id;
      }
    } else if (isType(gw, 'bpmn:InclusiveGateway')) {
      if (!this.orSelectedFlowIds[gw.id]) {
        var map = {};
        var hasConditional = defaultFlowId && outgoing.some(function(f) { return f.id !== defaultFlowId; });
        outgoing.forEach(function(f) {
          // BPMN 2.0 Default Flow Rule: Default flow '/' is FALSE when conditional branches are active!
          if (hasConditional && f.id === defaultFlowId) {
            map[f.id] = false;
          } else {
            map[f.id] = true;
          }
        });
        this.orSelectedFlowIds[gw.id] = map;
      }
    }
  };

  /**
   * Returns the effective outgoing flow that an XOR Split will take next.
   * Safely distinguishes Rework branch (`reworkFlowId`) from Exit branch (`exitFlowId`)
   * so clicking the Exit pill never flips back into an infinite loop!
   */
  BpmnTokenSimulationService.prototype._getEffectiveXorOutgoingFlow = function(gw, consumeVisit) {
    var outgoing = getSequenceOutgoing(gw);
    if (!outgoing.length) return null;
    if (outgoing.length === 1) return outgoing[0];

    this._ensureGatewaySelections(gw);
    var selectedId = this.xorSelectedFlowId[gw.id];
    var selectedFlow = outgoing[0];
    for (var i = 0; i < outgoing.length; i++) {
      if (outgoing[i].id === selectedId) {
        selectedFlow = outgoing[i];
        break;
      }
    }

    var loopInfo = this.detectedLoops[gw.id];
    var reworkId = (loopInfo && loopInfo.backFlowId) || this.loopReworkFlowId[gw.id];
    var maxIter = this.loopMaxIterations[gw.id];

    // Only count & switch away when the selected flow IS the rework/loopback branch!
    if (maxIter !== undefined && maxIter >= 0 && reworkId && selectedFlow.id === reworkId) {
      var visitsSoFar = this.xorVisitCounts[gw.id] || 0;
      if (consumeVisit) {
        this.xorVisitCounts[gw.id] = visitsSoFar + 1;
      }
      if (visitsSoFar >= maxIter) {
        if (loopInfo && loopInfo.exitFlowId) {
          for (var e = 0; e < outgoing.length; e++) {
            if (outgoing[e].id === loopInfo.exitFlowId) return outgoing[e];
          }
        }
        for (var j = 0; j < outgoing.length; j++) {
          if (outgoing[j].id !== selectedFlow.id) {
            return outgoing[j];
          }
        }
      }
    }
    return selectedFlow;
  };

  BpmnTokenSimulationService.prototype._clearOverlays = function() {
    var self = this;
    if (!this.overlays) return;
    this.overlayIds.forEach(function(id) {
      try { self.overlays.remove(id); } catch (e) {}
    });
    this.overlayIds = [];
  };

  BpmnTokenSimulationService.prototype._refreshGatewayOverlays = function() {
    var self = this;
    if (typeof document === 'undefined' || !this.overlays || !this.elementRegistry) return;
    this._clearOverlays();
    if (!this.simActive) return;

    var all = this.elementRegistry.getAll();
    // Hide clutter on a brand-new blank diagram (only 1 unconnected StartEvent)
    var hasAnySeqFlow = all.some(function(e) { return isType(e, 'bpmn:SequenceFlow'); });
    if (!hasAnySeqFlow) return;

    all.forEach(function(el) {
      // 1. Non-intrusive Play Trigger Badge above instantiable Root StartEvents
      if (self._isInstantiableRootStartEvent(el) && getSequenceOutgoing(el).length > 0) {
        var playPill = document.createElement('button');
        playPill.type = 'button';
        playPill.className = 'bpmn-sim-start-play-pill';
        playPill.textContent = '▶ Token';
        playPill.title = 'Spawn a token at this Start Event (clicking the circle itself edits normally)';
        playPill.addEventListener('click', function(ev) {
          ev.stopPropagation();
          self.spawnTokenAtStart(el);
        });
        var sOvId = self.overlays.add(el, {
          position: { top: -22, left: -6 },
          html: playPill
        });
        self.overlayIds.push(sOvId);
      }

      // 2. Gateway Branch Selection Pills (SequenceFlows ONLY!)
      var seqOut = getSequenceOutgoing(el);
      if (isGateway(el) && seqOut.length > 1) {
        self._ensureGatewaySelections(el);
        var defaultFlowId = getDefaultFlowId(el);

        if (isType(el, 'bpmn:ExclusiveGateway') || isType(el, 'bpmn:EventBasedGateway')) {
          var isRaceMode = self._isDynamicEventRaceGateway(el);
          var chosenId = self.xorSelectedFlowId[el.id];
          var loopInfo = self.detectedLoops[el.id];

          seqOut.forEach(function(flow, idx) {
            var mid = getFlowMidpoint(flow);
            var bo = getBusinessObject(flow);
            var targetBo = flow.target ? getBusinessObject(flow.target) : null;
            var baseLabel = bo.name || (isType(el, 'bpmn:EventBasedGateway') && targetBo && targetBo.name ? targetBo.name : ('Path ' + (idx + 1)));
            var prefix = (flow.id === defaultFlowId) ? '/ ' : '';
            var isChosen = isRaceMode ? true : (flow.id === chosenId);

            var pill = document.createElement('div');
            pill.className = 'bpmn-sim-branch-pill ' + (isChosen ? 'active' : 'inactive');
            if (isRaceMode) {
              pill.textContent = '⚡ ' + prefix + baseLabel;
              pill.title = 'Event-Based Gateway: Dynamic event race active. Click to force this branch manually.';
            } else if (loopInfo && flow.id === loopInfo.backFlowId && isChosen) {
              var iterCnt = self.loopMaxIterations[el.id] !== undefined ? self.loopMaxIterations[el.id] : 1;
              pill.textContent = '↻ ' + prefix + baseLabel + ' (' + iterCnt + '×)';
              pill.title = 'Loop Rework Branch (' + iterCnt + ' iteration before exit). Click to cycle 1× / 2× rework.';
            } else {
              pill.textContent = (isChosen ? '● ' : '○ ') + prefix + baseLabel;
              pill.title = 'Exclusive Path: Click to select "' + baseLabel + '"';
            }

            pill.addEventListener('click', function(ev) {
              ev.stopPropagation();
              if (isType(el, 'bpmn:EventBasedGateway')) {
                if (!self.eventGatewayManualOverride[el.id]) {
                  self.eventGatewayManualOverride[el.id] = true;
                  self.xorSelectedFlowId[el.id] = flow.id;
                } else if (self.xorSelectedFlowId[el.id] === flow.id) {
                  self.eventGatewayManualOverride[el.id] = false;
                } else {
                  self.xorSelectedFlowId[el.id] = flow.id;
                }
              } else if (loopInfo && flow.id === loopInfo.backFlowId && self.xorSelectedFlowId[el.id] === flow.id) {
                self.loopMaxIterations[el.id] = (self.loopMaxIterations[el.id] === 1) ? 2 : 1;
              } else {
                self.xorSelectedFlowId[el.id] = flow.id;
              }
              self._refreshGatewayOverlays();
              self._setCallout(
                'Branch Selection Updated: "' + baseLabel + '".',
                loopInfo && flow.id === loopInfo.exitFlowId
                  ? '0 rework cycles: Token will exit immediately via "' + baseLabel + '" on first pass.'
                  : 'Gateway will route incoming tokens according to the updated selection.',
                'Gateway Rule'
              );
            });

            var fOrigin = getFlowBBoxOrigin(flow);
            var ovId = self.overlays.add(flow, {
              position: {
                left: mid.x - fOrigin.x - 35,
                top: mid.y - fOrigin.y - 14
              },
              html: pill
            });
            self.overlayIds.push(ovId);
          });
        } else if (isType(el, 'bpmn:InclusiveGateway')) {
          var selMap = self.orSelectedFlowIds[el.id] || {};
          seqOut.forEach(function(flow, idx) {
            var mid = getFlowMidpoint(flow);
            var bo = getBusinessObject(flow);
            var isDefault = (flow.id === defaultFlowId);
            var label = (isDefault ? '/ ' : '') + (bo.name || ('OR Path ' + (idx + 1)));
            var isChosen = Boolean(selMap[flow.id]);

            var pill = document.createElement('div');
            pill.className = 'bpmn-sim-branch-pill ' + (isChosen ? 'active' : 'inactive');
            pill.textContent = (isChosen ? '☑ ' : '☐ ') + label;
            pill.title = isDefault
              ? 'Default Flow "/": Taken only when all other conditions evaluate to false'
              : 'OR Split: Click to toggle path active/inactive';
            pill.addEventListener('click', function(ev) {
              ev.stopPropagation();
              if (isDefault) {
                seqOut.forEach(function(f) { selMap[f.id] = (f.id === defaultFlowId); });
                self._setCallout(
                  'Default Flow ("/") Activated: "' + (bo.name || 'Default') + '".',
                  'In BPMN 2.0, the Default Flow on an Inclusive OR Split is taken if and only if all other branch conditions evaluate to false.',
                  'Default Flow'
                );
              } else {
                var nextVal = !selMap[flow.id];
                if (nextVal && defaultFlowId) {
                  selMap[defaultFlowId] = false;
                }
                selMap[flow.id] = nextVal;
                var anyActive = seqOut.some(function(f) { return Boolean(selMap[f.id]); });
                if (!anyActive) {
                  if (defaultFlowId) {
                    selMap[defaultFlowId] = true;
                    self._setCallout(
                      'All Conditional Branches Off -> Default Flow ("/") Selected.',
                      'When no conditional branch is selected, the Inclusive Gateway automatically falls back to the "/" Default Flow.',
                      'Default Fallback'
                    );
                  } else {
                    selMap[flow.id] = true;
                    self._setCallout(
                      'Inclusive OR Split Rule: At least ONE outgoing path must be active!',
                      'An OR split without a Default Flow ("/") requires one or more active paths.',
                      'OR Split Rule'
                    );
                    return;
                  }
                }
              }
              self._refreshGatewayOverlays();
            });

            var fOriginOr = getFlowBBoxOrigin(flow);
            var ovId = self.overlays.add(flow, {
              position: {
                left: mid.x - fOriginOr.x - 35,
                top: mid.y - fOriginOr.y - 14
              },
              html: pill
            });
            self.overlayIds.push(ovId);
          });
        }
      }

      // 3. Dwell Badges on Leaf Activities (and Collapsed SubProcesses; skip Expanded SubProcesses & Compensation)
      if (isActivity(el) && !self._isExpandedSubProcess(el) && !self._isCompensationActivity(el)) {
        var mins = self._getActivityDwellMinutes(el);
        var badge = document.createElement('div');
        badge.className = 'bpmn-sim-dwell-badge';
        badge.textContent = '⏱ ' + mins + ' min';
        badge.title = 'Activity Dwell Time (Click to change processing duration)';
        badge.addEventListener('click', function(ev) {
          ev.stopPropagation();
          var cycle = [5, 10, 15, 20, 25, 30, 35, 40, 45, 60];
          var nextIdx = (cycle.indexOf(mins) + 1) % cycle.length;
          self.customDwellMinutes[el.id] = cycle[nextIdx];
          self._refreshGatewayOverlays();
        });
        var ovId = self.overlays.add(el, {
          position: { top: -12, right: 65 },
          html: badge
        });
        self.overlayIds.push(ovId);
      }

      // 4. Interactive Boundary Event Trigger Pill when Host Activity/SubProcess is Active!
      if (isBoundaryEvent(el) && !hasEventDefinition(el, 'bpmn:CompensateEventDefinition') && getSequenceOutgoing(el).length > 0) {
        var bBo = getBusinessObject(el);
        var hostId = (el.host && el.host.id) || (bBo.attachedToRef && (typeof bBo.attachedToRef === 'string' ? bBo.attachedToRef : bBo.attachedToRef.id));
        var activeHostToken = self.tokens.filter(function(t) {
          return (t.state === 'DWELLING' || t.state === 'SUBPROCESS_WAIT') && t.currentNode && t.currentNode.id === hostId;
        })[0];

        if (activeHostToken) {
          var isInterrupting = (bBo.cancelActivity !== false);
          var bPill = document.createElement('button');
          bPill.type = 'button';
          bPill.className = 'bpmn-sim-boundary-pill' + (isInterrupting ? '' : ' non-int');
          bPill.textContent = isInterrupting ? '⚡ Interrupt' : '⚡ Fork';
          bPill.title = isInterrupting
            ? 'Interrupting Boundary Event: Click to abort running activity and divert token'
            : 'Non-Interrupting Boundary Event: Click to spawn parallel exception token while activity continues';
          bPill.addEventListener('click', function(ev) {
            ev.stopPropagation();
            self._fireBoundaryEvent(activeHostToken, el);
            self._renderSvgTokens();
            self._refreshGatewayOverlays();
          });
          var bOvId = self.overlays.add(el, {
            position: { top: 34, left: -12 },
            html: bPill
          });
          self.overlayIds.push(bOvId);
        }
      }

      // 5. Final State Reached Badge on Top-Level EndEvents
      if (isEndEvent(el) && self.reachedEndEvents[el.id]) {
        var fBadge = document.createElement('div');
        fBadge.className = 'bpmn-sim-final-state-badge';
        fBadge.textContent = '✓ Final State Reached (' + self.reachedEndEvents[el.id] + ')';
        var ovId2 = self.overlays.add(el, {
          position: { top: -26, left: -35 },
          html: fBadge
        });
        self.overlayIds.push(ovId2);
      }
    });
  };

  BpmnTokenSimulationService.prototype._setCallout = function(primaryText, secondaryText, refLabel) {
    this.lastCallout = {
      primary: primaryText,
      secondary: secondaryText,
      ref: refLabel,
      minutes: Math.round(this.simMinutes)
    };
    if (this.calloutWrap) {
      var pEl = this.calloutWrap.querySelector('[data-role="primary-text"]');
      var sEl = this.calloutWrap.querySelector('[data-role="secondary-text"]');
      var rEl = this.calloutWrap.querySelector('[data-role="ref-badge"]');
      if (pEl && primaryText) pEl.textContent = primaryText;
      if (sEl && secondaryText) sEl.textContent = secondaryText;
      if (rEl && refLabel) rEl.textContent = refLabel;
    }
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('bpmn-sim-token-callout', {
          detail: this.lastCallout
        }));
      } catch (e) {}
    }
  };

  BpmnTokenSimulationService.prototype._updateClockUI = function() {
    if (!this.toolbar) return;
    var clockEl = this.toolbar.querySelector('[data-role="clock"]');
    if (clockEl) {
      clockEl.textContent = '⏱ ' + Math.round(this.simMinutes) + ' min';
    }
  };

  BpmnTokenSimulationService.prototype.resetSimulation = function() {
    if (this.rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.running = false;
    this.paused = false;
    this.simMinutes = 0;
    this.tokens = [];
    this.nextTokenId = 1;
    this.nextEventGroupId = 1;
    this.xorVisitCounts = {};
    this.gatewayWaitQueues = {};
    this.xorJoinWinnerFlow = {};
    this.xorJoinBlockedFlows = {};
    this.deadlockedGateways = {};
    this.pendingMessages = {};
    this.reachedEndEvents = {};
    this.lastFrameTime = null;

    if (this.toolbar) {
      var pauseBtn = this.toolbar.querySelector('[data-action="pause-sim"]');
      if (pauseBtn) {
        pauseBtn.setAttribute('aria-pressed', 'false');
      }
    }
    this._updateClockUI();
    this._renderSvgTokens();
    this._refreshGatewayOverlays();
  };

  BpmnTokenSimulationService.prototype.startSimulation = function() {
    var self = this;
    this.resetSimulation();
    this._detectDiagramContext();

    var starts = this.elementRegistry.filter(function(el) {
      return self._isInstantiableRootStartEvent(el);
    });

    if (!starts.length) {
      this._setCallout(
        'No Instantiable Start Event found!',
        'Every BPMN process schema requires at least one top-level Start Event (not exclusively waiting on a Message Flow) to instantiate a token.',
        'Validation Warning'
      );
      return;
    }

    starts.forEach(function(st) {
      self.spawnTokenAtStart(st);
    });
  };

  BpmnTokenSimulationService.prototype.spawnTokenAtStart = function(startEl, parentTokenId) {
    var self = this;
    var outgoing = getSequenceOutgoing(startEl);
    if (!outgoing.length) return;

    if (!parentTokenId) {
      this._setCallout(
        'Process Instance Started: A token is born at "' + (getBusinessObject(startEl).name || 'Start Event') + '".',
        'A token represents the flow of a work item/order through the activity network.',
        'Token Concept · Start'
      );
    }

    outgoing.forEach(function(flow) {
      self._createTokenOnFlow(flow, parentTokenId || null);
    });
    this._emitOutgoingMessages(startEl);

    if (!this.running && typeof requestAnimationFrame !== 'undefined') {
      this.running = true;
      this.paused = false;
      this.lastFrameTime = performance.now();
      this._scheduleTick();
    }
  };

  BpmnTokenSimulationService.prototype._createTokenOnFlow = function(flow, parentTokenId, eventGroupId) {
    var pt = getPointAtProgress(flow.waypoints || [], 0);
    var token = {
      id: this.nextTokenId++,
      state: 'MOVING', // MOVING | MOVING_MSG | DWELLING | WAITING_TIMER | WAITING_EVENT | SUBPROCESS_WAIT | WAITING_JOIN | BLOCKED_XOR | DEADLOCKED | DONE
      currentFlow: flow,
      currentNode: null,
      parentTokenId: parentTokenId || null,
      eventGroupId: eventGroupId || null,
      firedBoundaryIds: {},
      progress: 0,
      dwellElapsedMin: 0,
      dwellTotalMin: 0,
      x: pt.x,
      y: pt.y
    };
    this.tokens.push(token);
    return token;
  };

  BpmnTokenSimulationService.prototype._emitOutgoingMessages = function(sourceEl) {
    var self = this;
    var msgFlows = getMessageOutgoing(sourceEl);
    msgFlows.forEach(function(mf) {
      var pt = getPointAtProgress(mf.waypoints || [], 0);
      self.tokens.push({
        id: self.nextTokenId++,
        state: 'MOVING_MSG',
        currentFlow: mf,
        currentNode: null,
        parentTokenId: null,
        eventGroupId: null,
        firedBoundaryIds: {},
        progress: 0,
        dwellElapsedMin: 0,
        dwellTotalMin: 0,
        x: pt.x,
        y: pt.y
      });
    });
  };

  BpmnTokenSimulationService.prototype._cancelEventGroupSiblings = function(winnerToken) {
    if (!winnerToken || !winnerToken.eventGroupId) return;
    var gid = winnerToken.eventGroupId;
    winnerToken.eventGroupId = null;
    this.tokens.forEach(function(other) {
      if (other.id !== winnerToken.id && other.eventGroupId === gid && other.state !== 'DONE') {
        other.state = 'DONE';
        other.eventGroupId = null;
      }
    });
  };

  BpmnTokenSimulationService.prototype._onMessageArriveAtTarget = function(msgToken, targetNode, mf) {
    var self = this;
    msgToken.state = 'DONE';
    if (!targetNode) return;

    // 1. Target is a Message StartEvent in another Pool (Cross-Pool Message Start)
    if (isStartEvent(targetNode)) {
      this._setCallout(
        'Message Flow Delivered at ' + Math.round(this.simMinutes) + ' min: Instantiating "' + (getBusinessObject(targetNode).name || targetNode.id) + '".',
        'Cross-pool collaboration: Incoming message instantiates a new token in the partner pool.',
        'Message Start'
      );
      getSequenceOutgoing(targetNode).forEach(function(sf) {
        self._createTokenOnFlow(sf, null);
      });
      return;
    }

    // 2. Target is an Attached Boundary Event on a running Activity
    if (isBoundaryEvent(targetNode)) {
      var bBo = getBusinessObject(targetNode);
      var hostId = (targetNode.host && targetNode.host.id) || (bBo.attachedToRef && (typeof bBo.attachedToRef === 'string' ? bBo.attachedToRef : bBo.attachedToRef.id));
      var hostTok = this.tokens.filter(function(t) {
        return (t.state === 'DWELLING' || t.state === 'SUBPROCESS_WAIT') && t.currentNode && t.currentNode.id === hostId;
      })[0];
      if (hostTok) {
        this._fireBoundaryEvent(hostTok, targetNode);
      }
      return;
    }

    // 3. Target is a Catching Message Intermediate Event or ReceiveTask
    var waitingTok = this.tokens.filter(function(t) {
      return t.state === 'WAITING_EVENT' && t.currentNode && t.currentNode.id === targetNode.id;
    })[0];

    if (waitingTok) {
      this._cancelEventGroupSiblings(waitingTok);
      this._setCallout(
        'Message Caught at ' + Math.round(this.simMinutes) + ' min: "' + (getBusinessObject(targetNode).name || targetNode.id) + '".',
        'Waiting token received its external message and continues along the chosen branch.',
        'Message Event'
      );
      this._routeFromCompletedNode(waitingTok, targetNode);
      return;
    }

    // Buffer message ONLY if a live token in the recipient pool can still reach `targetNode`
    var anyCanStillReachCatch = this.tokens.some(function(t) {
      if (t.state === 'DONE' || t.state === 'BLOCKED_XOR' || t.state === 'DEADLOCKED') return false;
      var startN = (t.state === 'MOVING' && t.currentFlow) ? t.currentFlow.target : t.currentNode;
      return self._canNodeReachTarget(startN, targetNode.id, null);
    });
    if (anyCanStillReachCatch) {
      this.pendingMessages[targetNode.id] = (this.pendingMessages[targetNode.id] || 0) + 1;
    }
  };

  BpmnTokenSimulationService.prototype._fireBoundaryEvent = function(hostToken, boundaryEl) {
    var self = this;
    if (!hostToken || !boundaryEl) return;
    var outFlows = getSequenceOutgoing(boundaryEl);
    if (!outFlows.length) return;

    var bBo = getBusinessObject(boundaryEl);
    var isInterrupting = (bBo.cancelActivity !== false);
    var hostNode = hostToken.currentNode;
    var hostName = hostNode ? (getBusinessObject(hostNode).name || hostNode.id) : 'Activity';
    var bName = bBo.name || boundaryEl.id;

    if (isInterrupting) {
      // Cancel any active child tokens if hostNode was an Expanded SubProcess
      if (hostToken.state === 'SUBPROCESS_WAIT') {
        this.tokens.forEach(function(ct) {
          if (ct.parentTokenId === hostToken.id && ct.state !== 'DONE') {
            ct.state = 'DONE';
          }
        });
      }
      this._setCallout(
        'Boundary Interrupting Event "' + bName + '" at ' + Math.round(this.simMinutes) + ' min.',
        '"' + hostName + '" terminates immediately and the token is diverted to the exception path.',
        'Interrupting Boundary'
      );
      hostToken.currentNode = null;
      hostToken.currentFlow = outFlows[0];
      hostToken.progress = 0;
      hostToken.state = 'MOVING';
      var pt = getPointAtProgress(outFlows[0].waypoints || [], 0);
      hostToken.x = pt.x;
      hostToken.y = pt.y;
      for (var i = 1; i < outFlows.length; i++) {
        this._createTokenOnFlow(outFlows[i], hostToken.parentTokenId);
      }
      this._checkDeadlocks();
      this._checkWaitingOrJoins();
    } else {
      this._setCallout(
        'Boundary Non-Interrupting Event "' + bName + '" at ' + Math.round(this.simMinutes) + ' min.',
        '"' + hostName + '" continues executing while a parallel token is cloned onto the boundary path.',
        'Non-Interrupting Boundary'
      );
      outFlows.forEach(function(f) {
        self._createTokenOnFlow(f, hostToken.parentTokenId);
      });
    }
    this._emitOutgoingMessages(boundaryEl);
  };

  BpmnTokenSimulationService.prototype.togglePause = function() {
    if (!this.running) return;
    this.paused = !this.paused;
    if (this.toolbar) {
      var pauseBtn = this.toolbar.querySelector('[data-action="pause-sim"]');
      if (pauseBtn) {
        pauseBtn.setAttribute('aria-pressed', this.paused ? 'true' : 'false');
      }
    }
    this._announceStatus(this.paused ? 'Simulation paused' : 'Simulation resumed');
    if (!this.paused && typeof requestAnimationFrame !== 'undefined') {
      this.lastFrameTime = performance.now();
      this._scheduleTick();
    }
  };

  BpmnTokenSimulationService.prototype.stepSimulation = function(stepMinutes) {
    if (!this.tokens.length) {
      this.startSimulation();
      this.paused = true;
    } else {
      this.paused = true;
    }
    if (this.toolbar) {
      var pauseBtn = this.toolbar.querySelector('[data-action="pause-sim"]');
      if (pauseBtn) {
        pauseBtn.setAttribute('aria-pressed', 'true');
      }
    }

    var safety = 0;
    while (this._hasMovingTokens() && safety++ < 250) {
      this._advanceSimulationStep(1.0);
    }

    var targetMin = this.simMinutes + (stepMinutes || 5);
    var guard = 0;
    while (this.simMinutes < targetMin - 1e-6 && this._hasActiveTokens() && guard++ < 600) {
      this._advanceSimulationStep(Math.min(1.0, targetMin - this.simMinutes));
      while (this._hasMovingTokens() && guard++ < 600) {
        this._advanceSimulationStep(1.0);
      }
    }

    this._renderSvgTokens();
    this._updateClockUI();
    this._refreshGatewayOverlays();
  };

  BpmnTokenSimulationService.prototype._hasMovingTokens = function() {
    return this.tokens.some(function(t) {
      return t.state === 'MOVING' || t.state === 'MOVING_MSG';
    });
  };

  BpmnTokenSimulationService.prototype._hasActiveTokens = function() {
    return this.tokens.some(function(t) {
      return (
        t.state === 'MOVING' ||
        t.state === 'MOVING_MSG' ||
        t.state === 'DWELLING' ||
        t.state === 'WAITING_TIMER'
      );
    });
  };

  BpmnTokenSimulationService.prototype._scheduleTick = function() {
    var self = this;
    if (!this.running || this.paused || typeof requestAnimationFrame === 'undefined') return;
    this.rafId = requestAnimationFrame(function(now) {
      if (!self.running || self.paused) return;
      var dtSec = Math.min((now - (self.lastFrameTime || now)) / 1000, 0.08);
      self.lastFrameTime = now;
      var deltaUnits = dtSec * self.minutesPerRealSecond * self.speedMultiplier;
      self._advanceSimulationStep(deltaUnits);
      self._renderSvgTokens();
      self._updateClockUI();

      if (self._hasActiveTokens()) {
        self._scheduleTick();
      } else {
        self.running = false;
        self._refreshGatewayOverlays();
      }
    });
  };

  /**
   * Checks whether a `WAITING_EVENT` node can still receive a message from any live token in another pool.
   */
  BpmnTokenSimulationService.prototype._canCatchNodeReceiveMessage = function(catchNode) {
    var self = this;
    if (!catchNode) return false;
    if ((this.pendingMessages[catchNode.id] || 0) > 0) return true;
    var incMsgs = getMessageIncoming(catchNode);
    if (!incMsgs.length) return false;
    return incMsgs.some(function(mf) {
      // Either a MOVING_MSG token is already on mf, or a live token can reach mf.source
      return self.tokens.some(function(t) {
        if (t.state === 'MOVING_MSG' && t.currentFlow && t.currentFlow.id === mf.id) return true;
        if (t.state === 'DONE' || t.state === 'BLOCKED_XOR' || t.state === 'DEADLOCKED' || t.state === 'MOVING_MSG') return false;
        if (t.state === 'WAITING_EVENT' && t.currentNode && t.currentNode.id === catchNode.id) return false;
        var sNode = (t.state === 'MOVING' && t.currentFlow) ? t.currentFlow.target : t.currentNode;
        return mf.source ? self._canNodeReachTarget(sNode, mf.source.id, null) : false;
      });
    });
  };

  /**
   * Barrier-Aware, Deadlock-Aware & Future-Loop-Aware Reachability Analysis:
   * Determines whether `token` can reach `targetGateway` (optionally via `requiredIncomingFlowId`).
   */
  BpmnTokenSimulationService.prototype._canTokenReachGateway = function(token, targetGateway, requiredIncomingFlowId) {
    var self = this;
    if (!token || !targetGateway) return false;
    if (
      token.state === 'DONE' ||
      token.state === 'MOVING_MSG' ||
      token.state === 'BLOCKED_XOR' ||
      token.state === 'DEADLOCKED'
    ) {
      return false;
    }
    if (token.state === 'WAITING_JOIN' && token.currentNode && token.currentNode.id === targetGateway.id) {
      return false;
    }
    if (token.state === 'WAITING_JOIN' && token.currentNode && this.deadlockedGateways[token.currentNode.id]) {
      return false;
    }
    if (token.state === 'WAITING_EVENT' && token.currentNode && !this._canCatchNodeReceiveMessage(token.currentNode)) {
      return false;
    }
    if (token.state === 'SUBPROCESS_WAIT' && token.currentNode) {
      var hasLiveChild = this.tokens.some(function(ct) {
        return ct.parentTokenId === token.id && ct.state !== 'DONE' && ct.state !== 'DEADLOCKED' && ct.state !== 'BLOCKED_XOR';
      });
      if (!hasLiveChild) return false;
    }

    // Direct incoming flow check
    if (token.state === 'MOVING' && token.currentFlow && token.currentFlow.target && token.currentFlow.target.id === targetGateway.id) {
      if (isType(targetGateway, 'bpmn:ExclusiveGateway') &&
          this.xorJoinBlockedFlows[targetGateway.id] &&
          this.xorJoinBlockedFlows[targetGateway.id][token.currentFlow.id]) {
        return false;
      }
      if (requiredIncomingFlowId && token.currentFlow.id !== requiredIncomingFlowId) {
        return false;
      }
      return true;
    }

    var startNode = null;
    if (token.state === 'MOVING' && token.currentFlow) {
      var immTgt = token.currentFlow.target;
      if (immTgt && isType(immTgt, 'bpmn:ExclusiveGateway') &&
          this.xorJoinBlockedFlows[immTgt.id] &&
          this.xorJoinBlockedFlows[immTgt.id][token.currentFlow.id]) {
        return false;
      }
      startNode = immTgt;
    } else if (token.currentNode) {
      startNode = token.currentNode;
    }
    if (!startNode) return false;

    var visitedFlows = {};
    var queue = [startNode];

    while (queue.length > 0) {
      var curr = queue.shift();
      if (!curr) continue;

      if (isGateway(curr) && this.deadlockedGateways[curr.id]) {
        continue;
      }

      var outFlows = getSequenceOutgoing(curr);
      if (isGateway(curr) && outFlows.length > 1) {
        this._ensureGatewaySelections(curr);
        if (isType(curr, 'bpmn:EventBasedGateway') && this._isDynamicEventRaceGateway(curr)) {
          // Any of the event-race branches may win depending on timing
          outFlows = outFlows.slice();
        } else if (isType(curr, 'bpmn:ExclusiveGateway') || isType(curr, 'bpmn:EventBasedGateway')) {
          var loopInfo = this.detectedLoops[curr.id];
          var reworkId = (loopInfo && loopInfo.backFlowId) || this.loopReworkFlowId[curr.id];
          var maxIter = this.loopMaxIterations[curr.id];
          var selectedId = this.xorSelectedFlowId[curr.id];
          var visitsSoFar = this.xorVisitCounts[curr.id] || 0;

          // CRITICAL FIX (Bug 1): If `curr` is a finite loop XOR Split currently on its rework cycle,
          // the token WILL traverse the rework loop AND THEN exit via `exitFlowId`!
          if (maxIter !== undefined && maxIter >= 0 && reworkId && selectedId === reworkId && visitsSoFar < maxIter) {
            outFlows = outFlows.slice();
          } else {
            var nextXorFlow = this._getEffectiveXorOutgoingFlow(curr, false);
            outFlows = nextXorFlow ? [nextXorFlow] : [];
          }
        } else if (isType(curr, 'bpmn:InclusiveGateway')) {
          var selMap = this.orSelectedFlowIds[curr.id] || {};
          outFlows = outFlows.filter(function(f) { return Boolean(selMap[f.id]); });
        }
      }

      // Also include automatic timed Interrupting/Non-Interrupting Boundary Event paths if configured on `curr`
      if (isActivity(curr)) {
        var bEvents = this._getAttachedBoundaryEvents(curr);
        var actDwell = this._getActivityDwellMinutes(curr);
        for (var bIdx = 0; bIdx < bEvents.length; bIdx++) {
          var bEv = bEvents[bIdx];
          if (curr === token.currentNode && token.firedBoundaryIds && token.firedBoundaryIds[bEv.id]) continue;
          var bMin = this._getElementExplicitMinutes(bEv);
          if (bMin !== null && bMin <= actDwell) {
            var bOuts = getSequenceOutgoing(bEv);
            var isInt = (getBusinessObject(bEv).cancelActivity !== false);
            if (isInt) {
              outFlows = bOuts.slice();
              break;
            } else {
              outFlows = outFlows.concat(bOuts);
            }
          }
        }
      }

      for (var i = 0; i < outFlows.length; i++) {
        var f = outFlows[i];
        if (visitedFlows[f.id]) continue;
        visitedFlows[f.id] = true;

        var nextNode = f.target;
        if (!nextNode) continue;

        if (isType(nextNode, 'bpmn:ExclusiveGateway') &&
            this.xorJoinBlockedFlows[nextNode.id] &&
            this.xorJoinBlockedFlows[nextNode.id][f.id]) {
          continue;
        }

        if (nextNode.id === targetGateway.id) {
          if (!requiredIncomingFlowId || f.id === requiredIncomingFlowId) {
            return true;
          }
          continue;
        }

        queue.push(nextNode);
      }
    }
    return false;
  };

  /**
   * Two-Phase Discrete-Event Simulation Step:
   * - Phase 1 (Visual Flow & Message Transition, Δt_sim = 0)
   * - Phase 2 (Activity Dwell, Boundary Timer & Intermediate Timer Phase, Δt_sim > 0)
   */
  BpmnTokenSimulationService.prototype._advanceSimulationStep = function(deltaUnits) {
    var self = this;

    // PHASE 1: Advance MOVING sequence-flow tokens and MOVING_MSG message-flow tokens (Δt_sim = 0)
    if (this._hasMovingTokens()) {
      var flowTravelUnits = 3.5;
      var movingSnapshot = this.tokens.filter(function(t) {
        return t.state === 'MOVING' || t.state === 'MOVING_MSG';
      });
      for (var i = 0; i < movingSnapshot.length; i++) {
        var token = movingSnapshot[i];
        if ((token.state !== 'MOVING' && token.state !== 'MOVING_MSG') || !token.currentFlow) continue;
        token.progress += deltaUnits / flowTravelUnits;
        if (token.progress >= 1.0) {
          token.progress = 1.0;
          var targetNode = token.currentFlow.target;
          var arrivedViaFlow = token.currentFlow;
          if (token.state === 'MOVING_MSG') {
            this._onMessageArriveAtTarget(token, targetNode, arrivedViaFlow);
          } else {
            this._onTokenArriveAtNode(token, targetNode, arrivedViaFlow);
          }
        } else {
          var pt = getPointAtProgress(token.currentFlow.waypoints || [], token.progress);
          token.x = pt.x;
          token.y = pt.y;
        }
      }
      this._checkDeadlocks();
      this._checkWaitingOrJoins();
      return;
    }

    // PHASE 2: Advance DWELLING activities (with timed Boundary Events) and WAITING_TIMER events
    var timedTokens = this.tokens.filter(function(t) {
      return (t.state === 'DWELLING' || t.state === 'WAITING_TIMER') && t.currentNode;
    });

    if (timedTokens.length > 0) {
      var minRemaining = Infinity;

      for (var j = 0; j < timedTokens.length; j++) {
        var tt = timedTokens[j];
        var rem = tt.dwellTotalMin - tt.dwellElapsedMin;
        if (rem < minRemaining) minRemaining = rem;

        if (tt.state === 'DWELLING') {
          var attached = this._getAttachedBoundaryEvents(tt.currentNode);
          for (var b = 0; b < attached.length; b++) {
            var bEl = attached[b];
            if (tt.firedBoundaryIds[bEl.id]) continue;
            var bTrigMin = this._getElementExplicitMinutes(bEl);
            if (bTrigMin !== null && bTrigMin <= tt.dwellTotalMin) {
              var bRem = bTrigMin - tt.dwellElapsedMin;
              if (bRem < minRemaining) minRemaining = bRem;
            }
          }
        }
      }

      var effectiveDeltaMin = Math.min(deltaUnits, Math.max(0.0001, minRemaining));
      this.simMinutes += effectiveDeltaMin;

      for (var k = 0; k < timedTokens.length; k++) {
        var dt = timedTokens[k];
        if (dt.state !== 'DWELLING' && dt.state !== 'WAITING_TIMER') continue;
        dt.dwellElapsedMin += effectiveDeltaMin;

        if (dt.state === 'DWELLING') {
          // 1. Check timed Boundary Events first (triggers while host activity is executing)
          var bList = this._getAttachedBoundaryEvents(dt.currentNode);
          for (var m = 0; m < bList.length; m++) {
            var bItem = bList[m];
            if (dt.firedBoundaryIds[bItem.id]) continue;
            var trigAt = this._getElementExplicitMinutes(bItem);
            if (trigAt !== null && trigAt <= dt.dwellTotalMin && dt.dwellElapsedMin >= trigAt - 1e-6) {
              dt.firedBoundaryIds[bItem.id] = true;
              this._fireBoundaryEvent(dt, bItem);
              if (dt.state !== 'DWELLING') break;
            }
          }
          // 2. Normal Activity completion
          if (dt.state === 'DWELLING' && dt.dwellElapsedMin >= dt.dwellTotalMin - 1e-6) {
            dt.dwellElapsedMin = dt.dwellTotalMin;
            this._onActivityCompleted(dt, dt.currentNode);
          }
        } else if (dt.state === 'WAITING_TIMER') {
          if (dt.dwellElapsedMin >= dt.dwellTotalMin - 1e-6) {
            dt.dwellElapsedMin = dt.dwellTotalMin;
            var timerNode = dt.currentNode;
            this._cancelEventGroupSiblings(dt);
            this._setCallout(
              'Timer Event Fired at ' + Math.round(this.simMinutes) + ' min: "' + (getBusinessObject(timerNode).name || timerNode.id) + '".',
              'Specified waiting duration elapsed; token continues along the timer branch.',
              'Timer Event'
            );
            this._routeFromCompletedNode(dt, timerNode);
          }
        }
      }
    }

    this._checkDeadlocks();
    this._checkWaitingOrJoins();

    // Kindler Vicious-Circle Breaker: If zero tokens are MOVING/DWELLING/WAITING_TIMER anywhere,
    // yet an OR-Join is still holding WAITING_JOIN tokens only because of another WAITING_JOIN OR-Join on a cycle:
    if (!this._hasActiveTokens()) {
      this._breakMutualOrJoinCycleIfAny();
    }
  };

  BpmnTokenSimulationService.prototype._breakMutualOrJoinCycleIfAny = function() {
    var self = this;
    var waitingOrGateways = Object.keys(this.gatewayWaitQueues).filter(function(gwId) {
      var gw = self.elementRegistry.get(gwId);
      if (!gw || !isType(gw, 'bpmn:InclusiveGateway')) return false;
      var q = self.gatewayWaitQueues[gwId] || {};
      return Object.keys(q).some(function(fid) {
        return (q[fid] || []).some(function(t) { return t.state === 'WAITING_JOIN'; });
      });
    });
    if (waitingOrGateways.length >= 2) {
      var firstGw = this.elementRegistry.get(waitingOrGateways[0]);
      if (firstGw) {
        this._forceReleaseOrJoin(firstGw);
      }
    }
  };

  BpmnTokenSimulationService.prototype._routeFromCompletedNode = function(token, node) {
    this._emitOutgoingMessages(node);
    var out = getSequenceOutgoing(node);
    if (!out.length) {
      token.state = 'DONE';
      return;
    }
    token.currentNode = null;
    token.currentFlow = out[0];
    token.progress = 0;
    token.state = 'MOVING';
    var pt = getPointAtProgress(out[0].waypoints || [], 0);
    token.x = pt.x;
    token.y = pt.y;

    for (var i = 1; i < out.length; i++) {
      this._createTokenOnFlow(out[i], token.parentTokenId);
    }
  };

  BpmnTokenSimulationService.prototype._onTokenArriveAtNode = function(token, node, arrivedViaFlow) {
    var self = this;
    if (!node) {
      token.state = 'DONE';
      return;
    }

    // 1. End Event (Top-Level Process OR Expanded SubProcess Internal EndEvent)
    if (isEndEvent(node)) {
      token.state = 'DONE';
      this._emitOutgoingMessages(node);

      var enclosingSub = this._getEnclosingSubProcess(node);

      // TerminateEndEvent semantics : terminate all live tokens in the same scope!
      if (hasEventDefinition(node, 'bpmn:TerminateEventDefinition')) {
        this.tokens.forEach(function(other) {
          if (other.id === token.id || other.state === 'DONE') return;
          if (enclosingSub) {
            if (other.parentTokenId === token.parentTokenId) other.state = 'DONE';
          } else if (!other.parentTokenId) {
            var otherPool = self._getEnclosingPoolId(other.currentNode || (other.currentFlow && other.currentFlow.source));
            var thisPool = self._getEnclosingPoolId(node);
            if (otherPool === thisPool) other.state = 'DONE';
          }
        });
      }

      if (enclosingSub && token.parentTokenId) {
        var parentTok = this.tokens.filter(function(pt) { return pt.id === token.parentTokenId; })[0];
        var anySiblingActive = this.tokens.some(function(st) {
          return (
            st.parentTokenId === token.parentTokenId &&
            st.state !== 'DONE' &&
            st.state !== 'BLOCKED_XOR' &&
            st.state !== 'DEADLOCKED'
          );
        });
        if (parentTok && parentTok.state === 'SUBPROCESS_WAIT' && !anySiblingActive) {
          this._setCallout(
            'Sub-Process "' + (getBusinessObject(enclosingSub).name || enclosingSub.id) + '" Completed at ' + Math.round(this.simMinutes) + ' min.',
            'All internal Sub-Process tokens reached Sub-End; parent process token resumes outgoing flow.',
            'Sub-Process Exit'
          );
          this._routeFromCompletedNode(parentTok, enclosingSub);
          this._refreshGatewayOverlays();
        }
        this._checkDeadlocks();
        this._checkWaitingOrJoins();
        return;
      }

      // Top-level Process EndEvent
      this.reachedEndEvents[node.id] = (this.reachedEndEvents[node.id] || 0) + 1;
      this._refreshGatewayOverlays();

      var activeRemaining = this.tokens.filter(function(t) {
        return (
          t.state === 'MOVING' ||
          t.state === 'MOVING_MSG' ||
          t.state === 'DWELLING' ||
          t.state === 'WAITING_TIMER' ||
          t.state === 'SUBPROCESS_WAIT' ||
          t.state === 'WAITING_JOIN'
        );
      });

      if (activeRemaining.length === 0) {
        this._setCallout(
          'A token is removed from the process flow as soon as it arrives at "' + (getBusinessObject(node).name || 'End Event') + '".',
          'The process flow is completed (Total Elapsed Time: ' + Math.round(this.simMinutes) + ' min).',
          'Token Concept · End Event'
        );
      } else {
        this._setCallout(
          'Token #' + token.id + ' exited at "' + (getBusinessObject(node).name || 'End Event') + '" (' + Math.round(this.simMinutes) + ' min)!',
          'Other active token(s) continue executing. Downstream OR Joins dynamically update synchronisation.',
          'Early / Pool Termination'
        );
      }
      this._checkDeadlocks();
      this._checkWaitingOrJoins();
      return;
    }

    // 2. Expanded SubProcess 
    if (this._isExpandedSubProcess(node)) {
      var subCenter = getElementCenter(node);
      token.state = 'SUBPROCESS_WAIT';
      token.currentFlow = null;
      token.currentNode = node;
      token.x = (node.x || subCenter.x) + 18;
      token.y = (node.y || subCenter.y) + 18;

      var childStarts = this._getSubProcessChildStarts(node);
      this._setCallout(
        'Entering Expanded Sub-Process "' + (getBusinessObject(node).name || node.id) + '" at ' + Math.round(this.simMinutes) + ' min.',
        'Parent token instantiates internal Sub-Process Start Event and waits for internal completion.',
        'Sub-Process'
      );
      childStarts.forEach(function(cs) {
        self.spawnTokenAtStart(cs, token.id);
      });
      this._refreshGatewayOverlays();
      return;
    }

    // 3. ReceiveTask with Incoming MessageFlow (waits for message if not already buffered)
    if (isType(node, 'bpmn:ReceiveTask') && getMessageIncoming(node).length > 0) {
      var rCenter = getElementCenter(node);
      token.currentFlow = null;
      token.currentNode = node;
      token.x = rCenter.x;
      token.y = rCenter.y;
      if ((this.pendingMessages[node.id] || 0) > 0) {
        this.pendingMessages[node.id]--;
        this._cancelEventGroupSiblings(token);
        this._routeFromCompletedNode(token, node);
      } else {
        token.state = 'WAITING_EVENT';
      }
      return;
    }

    // 4. Leaf Activity (Task / Collapsed SubProcess)
    if (isActivity(node)) {
      var center = getElementCenter(node);
      token.state = 'DWELLING';
      token.currentFlow = null;
      token.currentNode = node;
      token.firedBoundaryIds = {};
      token.x = center.x;
      token.y = center.y;
      token.dwellElapsedMin = 0;
      token.dwellTotalMin = this._getActivityDwellMinutes(node);

      this._setCallout(
        'Token #' + token.id + ' is executing "' + (getBusinessObject(node).name || node.id) + '" (Dwell Time: ' + token.dwellTotalMin + ' min).',
        'The behaviour is the same for all activities. Only the token\'s dwell time varies depending on the specific processing time.',
        'Activity Execution'
      );
      if (this._getAttachedBoundaryEvents(node).length > 0) {
        this._refreshGatewayOverlays();
      }
      return;
    }

    // 5. Gateways
    if (isGateway(node)) {
      this._handleGatewayArrival(token, node, arrivedViaFlow);
      return;
    }

    // 6. Intermediate Catch Event (Timer or Message )
    if (isIntermediateCatchEvent(node)) {
      var iCenter = getElementCenter(node);
      token.currentFlow = null;
      token.currentNode = node;
      token.x = iCenter.x;
      token.y = iCenter.y;

      var timerMins = this._getElementExplicitMinutes(node);
      if (hasEventDefinition(node, 'bpmn:TimerEventDefinition') || (timerMins !== null && getMessageIncoming(node).length === 0)) {
        token.state = 'WAITING_TIMER';
        token.dwellElapsedMin = 0;
        token.dwellTotalMin = timerMins !== null ? timerMins : 15;
        return;
      }

      if (getMessageIncoming(node).length > 0) {
        if ((this.pendingMessages[node.id] || 0) > 0) {
          this.pendingMessages[node.id]--;
          this._cancelEventGroupSiblings(token);
          this._routeFromCompletedNode(token, node);
        } else {
          token.state = 'WAITING_EVENT';
        }
        return;
      }
    }

    // 7. Intermediate Throw Event or plain pass-through node
    if (isIntermediateThrowEvent(node)) {
      this._emitOutgoingMessages(node);
    }
    this._routeFromCompletedNode(token, node);
  };

  BpmnTokenSimulationService.prototype._onActivityCompleted = function(token, activityNode) {
    this._routeFromCompletedNode(token, activityNode);
    if (this._getAttachedBoundaryEvents(activityNode).length > 0) {
      this._refreshGatewayOverlays();
    }
  };

  BpmnTokenSimulationService.prototype._handleGatewayArrival = function(token, gw, arrivedViaFlow) {
    var self = this;
    var incoming = getSequenceIncoming(gw);
    var isJoin = incoming.length > 1;

    // ---------------------------------------------------------
    // A. EXCLUSIVE GATEWAY (XOR) & EVENT-BASED GATEWAY
    // ---------------------------------------------------------
    if (isType(gw, 'bpmn:ExclusiveGateway') || isType(gw, 'bpmn:EventBasedGateway')) {
      if (isJoin) {
        if (this.xorJoinBlockedFlows[gw.id] && this.xorJoinBlockedFlows[gw.id][arrivedViaFlow.id]) {
          token.state = 'BLOCKED_XOR';
          token.currentFlow = arrivedViaFlow;
          token.currentNode = gw;
          var blockPos = getPointAtProgress(arrivedViaFlow.waypoints || [], 0.92);
          token.x = blockPos.x;
          token.y = blockPos.y;

          this._setCallout(
            'XOR Join BLOCKED at ' + Math.round(this.simMinutes) + ' min: Further tokens arriving later are blocked.',
            'Only one of the incoming paths may flow into an XOR join during a parallel race. The first token won the bid; this parallel token is blocked at the gateway barrier.',
            'XOR Join Block'
          );
          this._checkDeadlocks();
          this._checkWaitingOrJoins();
          return;
        }

        var concurrentTokenOnOtherPort = this.tokens.some(function(other) {
          if (other.id === token.id) return false;
          // Ignore sibling event-gateway watcher tokens that haven't resolved yet
          if (token.eventGroupId && other.eventGroupId === token.eventGroupId) return false;
          return incoming.some(function(inc) {
            if (inc.id === arrivedViaFlow.id) return false;
            return self._canTokenReachGateway(other, gw, inc.id);
          });
        });

        if (concurrentTokenOnOtherPort) {
          this.xorJoinWinnerFlow[gw.id] = arrivedViaFlow.id;
          this.xorJoinBlockedFlows[gw.id] = this.xorJoinBlockedFlows[gw.id] || {};
          incoming.forEach(function(incFlow) {
            if (incFlow.id !== arrivedViaFlow.id) {
              self.xorJoinBlockedFlows[gw.id][incFlow.id] = true;
            }
          });
          this._setCallout(
            'XOR Join Race Winner at ' + Math.round(this.simMinutes) + ' min: First token wins the bid and locks other ports.',
            'No synchronisation takes place at an XOR Join. The winning token passes immediately while other incoming ports are blocked.',
            'XOR Join Race'
          );
          this._checkWaitingOrJoins();
        } else {
          this._setCallout(
            'XOR Join Pass-Through at ' + Math.round(this.simMinutes) + ' min.',
            'Single active token passes through the Exclusive Join without delay.',
            'XOR Join'
          );
        }

        this._routeTokenOutOfGateway(token, gw);
        return;
      }

      this._routeTokenOutOfGateway(token, gw);
      return;
    }

    // ---------------------------------------------------------
    // B. PARALLEL GATEWAY (AND)
    // ---------------------------------------------------------
    if (isType(gw, 'bpmn:ParallelGateway')) {
      if (isJoin) {
        if (this.deadlockedGateways[gw.id]) {
          token.state = 'DEADLOCKED';
          token.currentNode = gw;
          token.currentFlow = arrivedViaFlow;
          var dlPt = getPointAtProgress(arrivedViaFlow.waypoints || [], 0.90);
          token.x = dlPt.x;
          token.y = dlPt.y;
          return;
        }

        if (!this.gatewayWaitQueues[gw.id]) {
          this.gatewayWaitQueues[gw.id] = {};
        }
        var q = this.gatewayWaitQueues[gw.id];
        if (!q[arrivedViaFlow.id]) q[arrivedViaFlow.id] = [];
        q[arrivedViaFlow.id].push(token);

        token.state = 'WAITING_JOIN';
        token.currentNode = gw;
        token.currentFlow = arrivedViaFlow;
        var waitPt = getPointAtProgress(arrivedViaFlow.waypoints || [], 0.90);
        token.x = waitPt.x;
        token.y = waitPt.y;

        var allArrived = incoming.every(function(inc) {
          return q[inc.id] && q[inc.id].some(function(wt) { return wt.state === 'WAITING_JOIN'; });
        });

        if (!allArrived) {
          this._setCallout(
            'AND Join (Synchronisation): Waiting at ' + Math.round(this.simMinutes) + ' min for parallel branches.',
            'At an AND join, all incoming tokens must wait until tokens on all other incoming branches have arrived.',
            'Token Concept · AND Join'
          );
          this._checkDeadlocks();
          return;
        }

        var mergedTokens = [];
        incoming.forEach(function(inc) {
          var t = q[inc.id].shift();
          if (t) mergedTokens.push(t);
        });

        var survivor = mergedTokens[0];
        for (var k = 1; k < mergedTokens.length; k++) {
          mergedTokens[k].state = 'DONE';
        }

        this._setCallout(
          'AND Join Synchronised at ' + Math.round(this.simMinutes) + ' min: All parallel tokens merged!',
          'All tokens merge into one single token when entering the gateway, and the process flow continues.',
          'Token Concept · AND Join Merge'
        );

        this._routeTokenOutOfGateway(survivor, gw);
        return;
      }

      this._routeTokenOutOfGateway(token, gw);
      return;
    }

    // ---------------------------------------------------------
    // C. INCLUSIVE GATEWAY (OR) — Non-Local Upstream Reachability Semantics
    // ---------------------------------------------------------
    if (isType(gw, 'bpmn:InclusiveGateway')) {
      if (isJoin) {
        if (!this.gatewayWaitQueues[gw.id]) {
          this.gatewayWaitQueues[gw.id] = {};
        }
        var orQueue = this.gatewayWaitQueues[gw.id];
        if (!orQueue[arrivedViaFlow.id]) orQueue[arrivedViaFlow.id] = [];
        orQueue[arrivedViaFlow.id].push(token);

        token.state = 'WAITING_JOIN';
        token.currentNode = gw;
        token.currentFlow = arrivedViaFlow;
        var orWaitPt = getPointAtProgress(arrivedViaFlow.waypoints || [], 0.90);
        token.x = orWaitPt.x;
        token.y = orWaitPt.y;

        this._evaluateOrJoin(gw);
        return;
      }

      this._routeTokenOutOfGateway(token, gw);
      return;
    }

    this._routeTokenOutOfGateway(token, gw);
  };

  /**
   * Automatic Structural Deadlock Detector for AND Joins (`ALG-11`, `ALG-12`, `ALG-17`, `ALG-26`):
   */
  BpmnTokenSimulationService.prototype._checkDeadlocks = function() {
    var self = this;
    var anyNewDeadlock = false;
    var changedInPass = false;

    do {
      changedInPass = false;
      Object.keys(this.gatewayWaitQueues).forEach(function(gwId) {
        if (self.deadlockedGateways[gwId]) return;
        var gw = self.elementRegistry.get(gwId);
        if (!gw || !isType(gw, 'bpmn:ParallelGateway')) return;

        var q = self.gatewayWaitQueues[gwId] || {};
        var waitingTokens = [];
        Object.keys(q).forEach(function(fid) {
          (q[fid] || []).forEach(function(t) {
            if (t.state === 'WAITING_JOIN') waitingTokens.push(t);
          });
        });
        if (waitingTokens.length === 0) return;

        var incoming = getSequenceIncoming(gw);
        var missingPortUnreachable = incoming.some(function(inc) {
          if (q[inc.id] && q[inc.id].some(function(wt) { return wt.state === 'WAITING_JOIN'; })) {
            return false;
          }
          var anyCanReachPort = self.tokens.some(function(other) {
            if (waitingTokens.indexOf(other) !== -1) return false;
            return self._canTokenReachGateway(other, gw, inc.id);
          });
          return !anyCanReachPort;
        });

        if (missingPortUnreachable) {
          self.deadlockedGateways[gwId] = true;
          anyNewDeadlock = true;
          changedInPass = true;
          waitingTokens.forEach(function(wt) {
            wt.state = 'DEADLOCKED';
          });
          self._setCallout(
            '⛔ DEADLOCK DETECTED at "' + (getBusinessObject(gw).name || gw.id) + '" (' + Math.round(self.simMinutes) + ' min).',
            'Token is waiting at an AND Join for a parallel branch that has 0 reachable upstream tokens. This gateway can never synchronize.',
            'Structural Deadlock'
          );
        }
      });
    } while (changedInPass);

    if (anyNewDeadlock) {
      this._checkWaitingOrJoins();
    }
  };

  BpmnTokenSimulationService.prototype._forceReleaseOrJoin = function(orJoinGw) {
    var orQueue = this.gatewayWaitQueues[orJoinGw.id];
    if (!orQueue) return;
    var waitingTokens = [];
    Object.keys(orQueue).forEach(function(flowId) {
      (orQueue[flowId] || []).forEach(function(t) {
        if (t.state === 'WAITING_JOIN') waitingTokens.push(t);
      });
      orQueue[flowId] = [];
    });
    if (!waitingTokens.length) return;
    var survivor = waitingTokens[0];
    for (var i = 1; i < waitingTokens.length; i++) {
      waitingTokens[i].state = 'DONE';
    }
    this._routeTokenOutOfGateway(survivor, orJoinGw);
  };

  BpmnTokenSimulationService.prototype._evaluateOrJoin = function(orJoinGw) {
    var self = this;
    var orQueue = this.gatewayWaitQueues[orJoinGw.id];
    if (!orQueue) return;

    var waitingTokens = [];
    Object.keys(orQueue).forEach(function(flowId) {
      (orQueue[flowId] || []).forEach(function(t) {
        if (t.state === 'WAITING_JOIN') waitingTokens.push(t);
      });
    });

    if (waitingTokens.length === 0) return;

    var otherTokenOnTheWay = this.tokens.some(function(other) {
      if (waitingTokens.indexOf(other) !== -1) return false;
      return self._canTokenReachGateway(other, orJoinGw, null);
    });

    if (otherTokenOnTheWay) {
      this._setCallout(
        'OR Join Waiting (Synchronising): Waiting for remaining active path(s) to arrive.',
        'Token arrived at OR Join after ' + Math.round(this.simMinutes) + ' min, while another active token is still underway toward this gateway.',
        'OR Join Sync'
      );
      return;
    }

    Object.keys(orQueue).forEach(function(flowId) {
      orQueue[flowId] = [];
    });

    var survivor = waitingTokens[0];
    for (var i = 1; i < waitingTokens.length; i++) {
      waitingTokens[i].state = 'DONE';
    }

    if (waitingTokens.length > 1) {
      this._setCallout(
        'OR Join Synchronised at ' + Math.round(this.simMinutes) + ' min: All ' + waitingTokens.length + ' active paths reached the gateway.',
        'The tokens merge into a single token and the process continues with the next task.',
        'OR Join Merged'
      );
    } else {
      this._setCallout(
        'OR Join Forwarded Immediately at ' + Math.round(this.simMinutes) + ' min (No Further Active Tokens Expected).',
        'Because no other active token can reach this OR join, the gateway forwards the token without waiting.',
        'OR Join Pass'
      );
    }

    this._routeTokenOutOfGateway(survivor, orJoinGw);
  };

  BpmnTokenSimulationService.prototype._checkWaitingOrJoins = function() {
    var self = this;
    Object.keys(this.gatewayWaitQueues).forEach(function(gwId) {
      var gw = self.elementRegistry.get(gwId);
      if (gw && isType(gw, 'bpmn:InclusiveGateway')) {
        self._evaluateOrJoin(gw);
      }
    });
  };

  BpmnTokenSimulationService.prototype._routeTokenOutOfGateway = function(token, gw) {
    var self = this;
    var outgoing = getSequenceOutgoing(gw);
    if (!outgoing.length) {
      token.state = 'DONE';
      return;
    }

    if (outgoing.length === 1) {
      token.state = 'MOVING';
      token.currentNode = null;
      token.currentFlow = outgoing[0];
      token.progress = 0;
      var pt0 = getPointAtProgress(outgoing[0].waypoints || [], 0);
      token.x = pt0.x;
      token.y = pt0.y;
      return;
    }

    this._ensureGatewaySelections(gw);

    // 0. Event-Based Gateway in Dynamic Race Mode (Dynamic Message vs. Timer Race)
    if (this._isDynamicEventRaceGateway(gw)) {
      var grpId = 'evgrp_' + (this.nextEventGroupId++);
      this._setCallout(
        'Event-Based Gateway: Waiting for whichever event occurs first.',
        'XOR event race started across ' + outgoing.length + ' catching branches — first triggered event cancels the remaining branches.',
        'Event Gateway'
      );
      token.state = 'MOVING';
      token.currentNode = null;
      token.currentFlow = outgoing[0];
      token.eventGroupId = grpId;
      token.progress = 0;
      var ptE = getPointAtProgress(outgoing[0].waypoints || [], 0);
      token.x = ptE.x;
      token.y = ptE.y;
      for (var eIdx = 1; eIdx < outgoing.length; eIdx++) {
        this._createTokenOnFlow(outgoing[eIdx], token.parentTokenId, grpId);
      }
      return;
    }

    // 1. XOR Split (or manually overridden Event-Based Gateway)
    if (isType(gw, 'bpmn:ExclusiveGateway') || isType(gw, 'bpmn:EventBasedGateway')) {
      var chosenFlow = this._getEffectiveXorOutgoingFlow(gw, true);
      var pathLabel = getBusinessObject(chosenFlow).name || chosenFlow.id;
      this._setCallout(
        'XOR Split Condition Tested: Token enters "' + pathLabel + '" exclusively.',
        'Only those activities situated along the chosen path will be executed.',
        'Token Concept · XOR Split'
      );
      token.state = 'MOVING';
      token.currentNode = null;
      token.currentFlow = chosenFlow;
      token.progress = 0;
      var ptX = getPointAtProgress(chosenFlow.waypoints || [], 0);
      token.x = ptX.x;
      token.y = ptX.y;
      return;
    }

    // 2. AND Split -> clone token onto ALL outgoing sequence flows
    if (isType(gw, 'bpmn:ParallelGateway')) {
      this._setCallout(
        'AND Split (Forking): All ' + outgoing.length + ' outgoing paths must be entered!',
        'The token arriving at the gateway is cloned — for ' + outgoing.length + ' parallel paths, ' + outgoing.length + ' tokens now exist.',
        'Token Concept · AND Split'
      );
      token.state = 'MOVING';
      token.currentNode = null;
      token.currentFlow = outgoing[0];
      token.progress = 0;
      var ptA = getPointAtProgress(outgoing[0].waypoints || [], 0);
      token.x = ptA.x;
      token.y = ptA.y;
      for (var j = 1; j < outgoing.length; j++) {
        this._createTokenOnFlow(outgoing[j], token.parentTokenId);
      }
      return;
    }

    // 3. OR Split -> clone token onto all SELECTED outgoing sequence flows (respecting Default '/')
    if (isType(gw, 'bpmn:InclusiveGateway')) {
      var selMap = this.orSelectedFlowIds[gw.id] || {};
      var activeFlows = outgoing.filter(function(f) { return Boolean(selMap[f.id]); });
      if (!activeFlows.length) {
        var defId = getDefaultFlowId(gw);
        var defFlow = defId ? outgoing.filter(function(f) { return f.id === defId; })[0] : null;
        activeFlows = [defFlow || outgoing[0]];
      }

      var names = activeFlows.map(function(f) { return getBusinessObject(f).name || f.id; }).join(' + ');
      this._setCallout(
        'Inclusive OR Split: ' + activeFlows.length + ' path(s) activated (' + names + ').',
        'One or more outgoing paths may be entered depending on the decision conditions. Active tokens: ' + activeFlows.length + '.',
        'OR Split'
      );

      token.state = 'MOVING';
      token.currentNode = null;
      token.currentFlow = activeFlows[0];
      token.progress = 0;
      var ptO = getPointAtProgress(activeFlows[0].waypoints || [], 0);
      token.x = ptO.x;
      token.y = ptO.y;
      for (var m = 1; m < activeFlows.length; m++) {
        this._createTokenOnFlow(activeFlows[m], token.parentTokenId);
      }
      return;
    }

    token.state = 'MOVING';
    token.currentNode = null;
    token.currentFlow = outgoing[0];
    token.progress = 0;
  };

  BpmnTokenSimulationService.prototype._renderSvgTokens = function() {
    var self = this;
    var layer = this._ensureSvgLayer();
    if (!layer) return;

    while (layer.firstChild) {
      layer.removeChild(layer.firstChild);
    }

    var ns = 'http://www.w3.org/2000/svg';

    // 1. Render XOR Join Blocking Barrier Bars (Video 04:45)
    Object.keys(this.xorJoinBlockedFlows).forEach(function(gwId) {
      var gw = self.elementRegistry.get(gwId);
      if (!gw) return;
      var blockedMap = self.xorJoinBlockedFlows[gwId] || {};
      getSequenceIncoming(gw).forEach(function(incFlow) {
        if (!blockedMap[incFlow.id]) return;
        var wps = incFlow.waypoints || [];
        if (wps.length < 2) return;
        var lastPt = wps[wps.length - 1];
        var prevPt = wps[wps.length - 2];
        var dx = lastPt.x - prevPt.x;
        var dy = lastPt.y - prevPt.y;

        var rect = document.createElementNS(ns, 'rect');
        if (Math.abs(dy) >= Math.abs(dx)) {
          rect.setAttribute('x', String(lastPt.x - 18));
          rect.setAttribute('y', String(lastPt.y - 3));
          rect.setAttribute('width', '36');
          rect.setAttribute('height', '6');
        } else {
          rect.setAttribute('x', String(lastPt.x - 3));
          rect.setAttribute('y', String(lastPt.y - 18));
          rect.setAttribute('width', '6');
          rect.setAttribute('height', '36');
        }
        rect.setAttribute('fill', '#6b7280');
        rect.setAttribute('stroke', '#dc2626');
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('rx', '2');
        layer.appendChild(rect);
      });
    });

    // 2. Render Tokens
    this.tokens.forEach(function(token) {
      if (token.state === 'DONE') return;

      var g = document.createElementNS(ns, 'g');
      g.setAttribute('transform', 'translate(' + token.x.toFixed(1) + ',' + token.y.toFixed(1) + ')');

      if (
        token.state === 'WAITING_JOIN' ||
        token.state === 'WAITING_EVENT' ||
        token.state === 'WAITING_TIMER' ||
        token.state === 'SUBPROCESS_WAIT' ||
        token.state === 'BLOCKED_XOR' ||
        token.state === 'DEADLOCKED'
      ) {
        var pulse = document.createElementNS(ns, 'circle');
        pulse.setAttribute('r', '16');
        var pFill = token.state === 'DEADLOCKED' ? 'rgba(126, 34, 206, 0.25)' :
                    (token.state === 'BLOCKED_XOR' ? 'rgba(220, 38, 38, 0.22)' :
                    (token.state === 'WAITING_EVENT' || token.state === 'WAITING_TIMER' ? 'rgba(2, 132, 199, 0.22)' : 'rgba(237, 110, 0, 0.22)'));
        var pStroke = token.state === 'DEADLOCKED' ? '#7e22ce' :
                      (token.state === 'BLOCKED_XOR' ? '#dc2626' :
                      (token.state === 'WAITING_EVENT' || token.state === 'WAITING_TIMER' ? '#0284c7' : '#ed6e00'));
        pulse.setAttribute('fill', pFill);
        pulse.setAttribute('stroke', pStroke);
        pulse.setAttribute('stroke-width', '1.5');
        pulse.setAttribute('stroke-dasharray', '3,2');
        g.appendChild(pulse);
      }

      var circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', token.state === 'MOVING_MSG' ? '10' : '11');
      var cFill = token.state === 'DEADLOCKED' ? '#7e22ce' :
                  (token.state === 'BLOCKED_XOR' ? '#dc2626' :
                  (token.state === 'MOVING_MSG' || token.state === 'WAITING_EVENT' ? '#0284c7' : '#ed6e00'));
      circle.setAttribute('fill', cFill);
      circle.setAttribute('stroke', token.state === 'MOVING_MSG' ? '#0c4a6e' : '#431407');
      circle.setAttribute('stroke-width', '2');
      g.appendChild(circle);

      var txt = document.createElementNS(ns, 'text');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dy', '3.5');
      txt.setAttribute('fill', '#ffffff');
      txt.setAttribute('font-family', 'Calibri, Arial, sans-serif');
      txt.setAttribute('font-size', '10px');
      txt.setAttribute('font-weight', '700');
      txt.textContent = (token.state === 'BLOCKED_XOR' || token.state === 'DEADLOCKED') ? '✕' :
                        (token.state === 'MOVING_MSG' ? '✉' : String(token.id));
      g.appendChild(txt);

      if ((token.state === 'DWELLING' || token.state === 'WAITING_TIMER') && token.dwellTotalMin > 0) {
        var pillBg = document.createElementNS(ns, 'rect');
        pillBg.setAttribute('x', '-34');
        pillBg.setAttribute('y', '14');
        pillBg.setAttribute('width', '68');
        pillBg.setAttribute('height', '16');
        pillBg.setAttribute('rx', '8');
        pillBg.setAttribute('fill', token.state === 'WAITING_TIMER' ? '#0369a1' : '#1f2937');
        g.appendChild(pillBg);

        var pillTxt = document.createElementNS(ns, 'text');
        pillTxt.setAttribute('text-anchor', 'middle');
        pillTxt.setAttribute('y', '25');
        pillTxt.setAttribute('fill', '#ffffff');
        pillTxt.setAttribute('font-family', 'Calibri, Arial, sans-serif');
        pillTxt.setAttribute('font-size', '9.5px');
        pillTxt.setAttribute('font-weight', '700');
        pillTxt.textContent = Math.round(token.dwellElapsedMin) + '/' + token.dwellTotalMin + 'm';
        g.appendChild(pillTxt);
      } else if (token.state === 'WAITING_EVENT') {
        var eBg = document.createElementNS(ns, 'rect');
        eBg.setAttribute('x', '-32');
        eBg.setAttribute('y', '-28');
        eBg.setAttribute('width', '64');
        eBg.setAttribute('height', '14');
        eBg.setAttribute('rx', '4');
        eBg.setAttribute('fill', '#0369a1');
        g.appendChild(eBg);

        var eTxt = document.createElementNS(ns, 'text');
        eTxt.setAttribute('text-anchor', 'middle');
        eTxt.setAttribute('y', '-18');
        eTxt.setAttribute('fill', '#ffffff');
        eTxt.setAttribute('font-family', 'Calibri, Arial, sans-serif');
        eTxt.setAttribute('font-size', '8.5px');
        eTxt.setAttribute('font-weight', '700');
        eTxt.textContent = '✉ AWAIT';
        g.appendChild(eTxt);
      } else if (token.state === 'WAITING_JOIN') {
        var wBg = document.createElementNS(ns, 'rect');
        wBg.setAttribute('x', '-26');
        wBg.setAttribute('y', '-28');
        wBg.setAttribute('width', '52');
        wBg.setAttribute('height', '14');
        wBg.setAttribute('rx', '4');
        wBg.setAttribute('fill', '#b45309');
        g.appendChild(wBg);

        var wTxt = document.createElementNS(ns, 'text');
        wTxt.setAttribute('text-anchor', 'middle');
        wTxt.setAttribute('y', '-18');
        wTxt.setAttribute('fill', '#ffffff');
        wTxt.setAttribute('font-family', 'Calibri, Arial, sans-serif');
        wTxt.setAttribute('font-size', '9px');
        wTxt.setAttribute('font-weight', '700');
        wTxt.textContent = 'WAITING';
        g.appendChild(wTxt);
      } else if (token.state === 'BLOCKED_XOR') {
        var bBg = document.createElementNS(ns, 'rect');
        bBg.setAttribute('x', '-28');
        bBg.setAttribute('y', '15');
        bBg.setAttribute('width', '56');
        bBg.setAttribute('height', '15');
        bBg.setAttribute('rx', '4');
        bBg.setAttribute('fill', '#991b1b');
        g.appendChild(bBg);

        var bTxt = document.createElementNS(ns, 'text');
        bTxt.setAttribute('text-anchor', 'middle');
        bTxt.setAttribute('y', '25.5');
        bTxt.setAttribute('fill', '#ffffff');
        bTxt.setAttribute('font-family', 'Calibri, Arial, sans-serif');
        bTxt.setAttribute('font-size', '9px');
        bTxt.setAttribute('font-weight', '700');
        bTxt.textContent = 'BLOCKED';
        g.appendChild(bTxt);
      } else if (token.state === 'DEADLOCKED') {
        var dBg = document.createElementNS(ns, 'rect');
        dBg.setAttribute('x', '-34');
        dBg.setAttribute('y', '15');
        dBg.setAttribute('width', '68');
        dBg.setAttribute('height', '15');
        dBg.setAttribute('rx', '4');
        dBg.setAttribute('fill', '#6b21a8');
        g.appendChild(dBg);

        var dTxt = document.createElementNS(ns, 'text');
        dTxt.setAttribute('text-anchor', 'middle');
        dTxt.setAttribute('y', '25.5');
        dTxt.setAttribute('fill', '#ffffff');
        dTxt.setAttribute('font-family', 'Calibri, Arial, sans-serif');
        dTxt.setAttribute('font-size', '9px');
        dTxt.setAttribute('font-weight', '700');
        dTxt.textContent = 'DEADLOCK';
        g.appendChild(dTxt);
      }

      layer.appendChild(g);
    });
  };

  /**
   * Headless / Synchronous Full Run Helper (used by automated 42-Algorithm Verification Suite!)
   */
  BpmnTokenSimulationService.prototype.runToCompletionSync = function(maxSteps) {
    this.startSimulation();
    this.running = false;
    var limit = maxSteps || 6000;
    var steps = 0;
    while (this._hasActiveTokens() && steps < limit) {
      this._advanceSimulationStep(1.0);
      steps++;
    }
    var completedEnds = 0;
    var self = this;
    Object.keys(this.reachedEndEvents).forEach(function(k) {
      completedEnds += self.reachedEndEvents[k];
    });
    var blockedCount = this.tokens.filter(function(t) { return t.state === 'BLOCKED_XOR'; }).length;
    var deadlockedCount = this.tokens.filter(function(t) { return t.state === 'DEADLOCKED'; }).length;
    return {
      simMinutes: Math.round(this.simMinutes),
      completedEnds: completedEnds,
      blockedCount: blockedCount,
      deadlockedCount: deadlockedCount,
      deadlockedGatewayCount: Object.keys(this.deadlockedGateways).length,
      totalTokensCreated: this.tokens.length,
      steps: steps
    };
  };

  /**
   * Topological & Metamodel Schema Validator :
   */
  BpmnTokenSimulationService.prototype.runSchemaValidation = function() {
    var self = this;
    var all = this.elementRegistry.getAll();
    var findings = [];

    var topStarts = all.filter(function(e) { return isStartEvent(e) && !self._getEnclosingSubProcess(e); });
    var topEnds = all.filter(function(e) { return isEndEvent(e) && !self._getEnclosingSubProcess(e); });
    var activities = all.filter(isActivity);
    var gateways = all.filter(isGateway);

    // 1. Start & End Event Checks
    if (topStarts.length === 0) {
      findings.push({ level: 'error', text: 'Missing Start Event: Every process schema requires at least one Start Event to initiate token flow.' });
    } else {
      findings.push({ level: 'ok', text: 'Start Event check passed (' + topStarts.length + ' top-level Start Event(s) found).' });
    }

    if (topEnds.length === 0) {
      findings.push({ level: 'error', text: 'Missing End Event: Every process schema requires at least one End Event where tokens are removed.' });
    } else {
      findings.push({ level: 'ok', text: 'End Event check passed (' + topEnds.length + ' top-level End Event(s) found).' });
    }

    all.filter(isStartEvent).forEach(function(st) {
      if (getSequenceIncoming(st).length > 0) {
        findings.push({ level: 'error', text: 'Start Event "' + (getBusinessObject(st).name || st.id) + '" must NOT have incoming Sequence Flows.' });
      }
      if (getSequenceOutgoing(st).length === 0) {
        findings.push({ level: 'error', text: 'Start Event "' + (getBusinessObject(st).name || st.id) + '" has no outgoing Sequence Flow.' });
      }
    });

    all.filter(isEndEvent).forEach(function(en) {
      if (getSequenceOutgoing(en).length > 0) {
        findings.push({ level: 'error', text: 'End Event "' + (getBusinessObject(en).name || en.id) + '" must NOT have outgoing Sequence Flows.' });
      }
      if (getSequenceIncoming(en).length === 0) {
        findings.push({ level: 'error', text: 'End Event "' + (getBusinessObject(en).name || en.id) + '" has no incoming Sequence Flow.' });
      }
    });

    // 2. Activity Sequence Flow Check (Compensation-Aware)
    activities.forEach(function(act) {
      if (self._isCompensationActivity(act)) return;
      var name = getBusinessObject(act).name || act.id;
      if (getSequenceIncoming(act).length === 0) {
        findings.push({ level: 'error', text: 'Activity "' + name + '" has no incoming Sequence Flow.' });
      }
      var hasBoundaryExit = self._getAttachedBoundaryEvents(act).length > 0;
      if (getSequenceOutgoing(act).length === 0 && !hasBoundaryExit) {
        findings.push({ level: 'error', text: 'Activity "' + name + '" has no outgoing Sequence Flow.' });
      }
      if (self._isExpandedSubProcess(act)) {
        var subStarts = self._getSubProcessChildStarts(act);
        var subEnds = all.filter(function(e) {
          var enc = self._getEnclosingSubProcess(e);
          return isEndEvent(e) && enc && enc.id === act.id;
        });
        if (subStarts.length === 0 || subEnds.length === 0) {
          findings.push({ level: 'error', text: 'Expanded Sub-Process "' + name + '" requires both an internal Start Event and End Event.' });
        }
      }
    });

    // 3. Gateway Disconnected Check
    gateways.forEach(function(gw) {
      var gName = getBusinessObject(gw).name || gw.id;
      if (getSequenceIncoming(gw).length === 0) {
        findings.push({ level: 'error', text: 'Gateway "' + gName + '" has no incoming Sequence Flow.' });
      }
      if (getSequenceOutgoing(gw).length === 0) {
        findings.push({ level: 'error', text: 'Gateway "' + gName + '" has no outgoing Sequence Flow.' });
      }
    });

    // 4. Pools & Message Flows Grammar 
    var isExpandedParticipant = function(partEl) {
      if (!partEl || !isType(partEl, 'bpmn:Participant')) return false;
      var pBo = getBusinessObject(partEl);
      if (!pBo || !pBo.processRef) return false;
      var procId = typeof pBo.processRef === 'string' ? pBo.processRef : pBo.processRef.id;
      return all.some(function(item) {
        if (item.id === partEl.id || item.id === procId) return false;
        return self._getEnclosingPoolId(item) === partEl.id && (isActivity(item) || isStartEvent(item) || isEndEvent(item));
      });
    };

    all.forEach(function(el) {
      var bo = getBusinessObject(el);
      if (!bo) return;

      if (bo.$type === 'bpmn:SequenceFlow' && el.source && el.target) {
        var sp1 = self._getEnclosingPoolId(el.source);
        var sp2 = self._getEnclosingPoolId(el.target);
        if (sp1 !== sp2) {
          findings.push({
            level: 'error',
            text: 'Invalid Modelling: Sequence Flow "' + el.id + '" crosses Pool boundaries. Use a Message Flow instead.'
          });
        }
      }

      if (bo.$type === 'bpmn:MessageFlow') {
        var src = el.source;
        var tgt = el.target;
        var srcBo = getBusinessObject(src);
        var tgtBo = getBusinessObject(tgt);

        if ((srcBo && srcBo.$type && srcBo.$type.indexOf('Gateway') !== -1) ||
            (tgtBo && tgtBo.$type && tgtBo.$type.indexOf('Gateway') !== -1)) {
          findings.push({
            level: 'error',
            text: 'Invalid Modelling: Gateways must NEVER be connected to Message Flows (' + el.id + ').'
          });
        }

        if (src && tgt) {
          var mp1 = self._getEnclosingPoolId(src);
          var mp2 = self._getEnclosingPoolId(tgt);
          if (mp1 === mp2) {
            findings.push({
              level: 'error',
              text: 'Invalid Modelling: Message Flow "' + el.id + '" connects elements inside the same Pool.'
            });
          }
        }

        if (src && (isStartEvent(src) || isIntermediateCatchEvent(src))) {
          findings.push({
            level: 'error',
            text: 'Invalid Modelling: Outgoing Message Flow "' + el.id + '" cannot originate from a Catching Event.'
          });
        }
        if (tgt && (isEndEvent(tgt) || isIntermediateThrowEvent(tgt))) {
          findings.push({
            level: 'error',
            text: 'Invalid Modelling: Incoming Message Flow "' + el.id + '" cannot target a Throwing/End Event.'
          });
        }

        if ((src && isExpandedParticipant(src)) || (tgt && isExpandedParticipant(tgt))) {
          findings.push({
            level: 'warn',
            text: 'Modelling Recommendation: Message Flow "' + el.id + '" is linked directly to an Expanded Pool border instead of a concrete Task or Message Event (indicates missing activity).'
          });
        }
      }
    });

    // 5. Simulation-Verified Structural Deadlock & Parallel XOR-Race Check!
    // Runs a clean, non-destructive headless shadow simulation on the exact current diagram & branch config!
    if (!findings.some(function(f) { return f.level === 'error'; })) {
      var shadow = new BpmnTokenSimulationService(null, null, this.elementRegistry, null, null);
      shadow.xorSelectedFlowId = Object.assign({}, this.xorSelectedFlowId);
      Object.keys(this.orSelectedFlowIds).forEach(function(k) {
        shadow.orSelectedFlowIds[k] = Object.assign({}, self.orSelectedFlowIds[k]);
      });
      shadow.loopMaxIterations = Object.assign({}, this.loopMaxIterations);
      shadow.loopReworkFlowId = Object.assign({}, this.loopReworkFlowId);
      shadow.customDwellMinutes = Object.assign({}, this.customDwellMinutes);
      shadow.eventGatewayManualOverride = Object.assign({}, this.eventGatewayManualOverride);

      var dryRes = shadow.runToCompletionSync(4000);
      Object.keys(shadow.deadlockedGateways).forEach(function(dlGwId) {
        var dlGw = self.elementRegistry.get(dlGwId);
        var dlName = dlGw ? (getBusinessObject(dlGw).name || dlGw.id) : dlGwId;
        findings.push({
          level: 'error',
          text: 'Structural Deadlock Detected: Parallel AND Join "' + dlName + '" waits forever for an unactivated upstream branch (e.g., XOR Split or partial OR Split feeding an AND Join).'
        });
      });

      Object.keys(shadow.xorJoinBlockedFlows).forEach(function(xGwId) {
        var blockedCountOnGw = shadow.tokens.filter(function(t) {
          return t.state === 'BLOCKED_XOR' && t.currentNode && t.currentNode.id === xGwId;
        }).length;
        if (blockedCountOnGw > 0) {
          var xGw = self.elementRegistry.get(xGwId);
          var xName = xGw ? (getBusinessObject(xGw).name || xGw.id) : xGwId;
          findings.push({
            level: 'warn',
            text: 'Token Semantics Warning: Concurrent parallel tokens race into Exclusive XOR Join "' + xName + '" — first token passes while ' + blockedCountOnGw + ' later token(s) are blocked at the barrier.'
          });
        }
      });

      if (dryRes.completedEnds === 0 && Object.keys(shadow.deadlockedGateways).length === 0) {
        findings.push({
          level: 'warn',
          text: 'Token Liveness Warning: Simulation did not reach any top-level End Event (check waiting Message Events or disconnected paths).'
        });
      }
    }

    if (!findings.some(function(f) { return f.level === 'error' || f.level === 'warn'; })) {
      findings.push({
        level: 'ok',
        text: 'All BPMN 2.0 grammar, Pool/MessageFlow rules, and Token Flow soundness checks passed.'
      });
    }

    if (this.valPanel) {
      this.valPanel.style.display = 'block';
      this.valPanel.innerHTML = [
        '<div class="bpmn-sim-validation-header">',
        '  <span>✓ BPMN 2.0 Validation</span>',
        '  <button type="button" class="bpmn-sim-sim-btn" data-close-val="1" style="padding:2px 7px;" aria-label="Close validation report">✕</button>',
        '</div>',
        findings.map(function(f) {
          var cls = f.level === 'error' ? 'error' : (f.level === 'warn' ? 'warn' : '');
          var icon = f.level === 'error' ? '⛔ ' : (f.level === 'warn' ? '⚠️ ' : '✅ ');
          return '<div class="bpmn-sim-val-item ' + cls + '">' + icon + f.text + '</div>';
        }).join('')
      ].join('');

      this.valPanel.querySelector('[data-close-val="1"]').addEventListener('click', function() {
        self.valPanel.style.display = 'none';
      });
    }
    return findings;
  };

  var BpmnTokenSimulationModule = {
    __init__: ['bpmnTokenSimulation'],
    bpmnTokenSimulation: ['type', BpmnTokenSimulationService]
  };

  if (typeof window !== 'undefined') {
    window.plugins = window.plugins || [];
    if (!window.__bpmnTokenSimPluginRegistered) {
      window.__bpmnTokenSimPluginRegistered = true;
      window.plugins.push({
        plugin: BpmnTokenSimulationModule,
        type: 'bpmn.modeler.additionalModules'
      });
    }
    window.BpmnTokenSimulationModule = BpmnTokenSimulationModule;
    window.BpmnTokenSimulationService = BpmnTokenSimulationService;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      BpmnTokenSimulationModule: BpmnTokenSimulationModule,
      BpmnTokenSimulationService: BpmnTokenSimulationService
    };
  }
})();
