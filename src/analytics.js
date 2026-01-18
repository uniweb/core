/**
 * Analytics
 *
 * Lightweight analytics class for tracking page views, events, and scroll depth.
 * Uses batched sending with sendBeacon for reliable delivery.
 *
 * Features:
 * - Batched event queue with periodic flush
 * - Page view tracking
 * - Custom event tracking
 * - Scroll depth tracking (25%, 50%, 75%, 100%)
 * - sendBeacon for reliable unload delivery
 * - Optional - silently ignores if not configured
 *
 * Usage via uniweb singleton:
 * ```js
 * // Track events (no-op if analytics not configured)
 * uniweb.analytics.trackPageView('/about', 'About Us')
 * uniweb.analytics.trackEvent('button_click', { buttonId: 'cta' })
 * uniweb.analytics.trackScrollDepth(50)
 * ```
 */

// Check if running in browser environment
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

export default class Analytics {
  /**
   * @param {Object} options
   * @param {string} options.endpoint - Analytics endpoint URL (required to enable)
   * @param {number} options.flushInterval - Interval to flush queue in ms (default: 5000)
   * @param {number} options.maxQueueSize - Max events before auto-flush (default: 10)
   * @param {boolean} options.debug - Enable debug logging (default: false)
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint || null
    this.flushInterval = options.flushInterval || 5000
    this.maxQueueSize = options.maxQueueSize || 10
    this.debug = options.debug || false

    // Event queue
    this.queue = []

    // Track scroll depth milestones already sent (to avoid duplicates)
    this.scrollMilestones = new Set()

    // Session info
    this.sessionId = this.generateSessionId()
    this.sessionStart = Date.now()

    // Only set up browser handlers if in browser and configured
    if (isBrowser && this.isEnabled()) {
      this.setupFlushInterval()
      this.setupUnloadHandler()
    }
  }

  /**
   * Check if analytics is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return !!this.endpoint
  }

  /**
   * Generate a simple session ID
   * @returns {string}
   */
  generateSessionId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Set up periodic flush interval
   */
  setupFlushInterval() {
    this.flushIntervalId = setInterval(() => {
      this.flush()
    }, this.flushInterval)
  }

  /**
   * Set up unload handler for final flush
   */
  setupUnloadHandler() {
    const handleUnload = () => {
      this.flush(true) // Force beacon
    }

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        handleUnload()
      }
    })

    window.addEventListener('pagehide', handleUnload)
  }

  /**
   * Add event to queue
   * @param {string} type - Event type
   * @param {Object} data - Event data
   */
  addToQueue(type, data) {
    if (!this.isEnabled() || !isBrowser) return

    const event = {
      type,
      data,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      url: window.location.href,
      referrer: document.referrer || null
    }

    this.queue.push(event)

    if (this.debug) {
      console.log('[Analytics] Event queued:', event)
    }

    // Auto-flush if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.flush()
    }
  }

  /**
   * Track a page view
   * @param {string} path - Page path
   * @param {string} title - Page title
   * @param {Object} meta - Additional metadata
   */
  trackPageView(path, title, meta = {}) {
    // Reset scroll milestones for new page
    this.scrollMilestones.clear()

    this.addToQueue('pageview', {
      path,
      title,
      ...meta
    })
  }

  /**
   * Track a custom event
   * @param {string} name - Event name
   * @param {Object} data - Event data
   */
  trackEvent(name, data = {}) {
    this.addToQueue('event', {
      name,
      ...data
    })
  }

  /**
   * Track scroll depth milestone
   * @param {number} percentage - Scroll depth percentage (25, 50, 75, 100)
   */
  trackScrollDepth(percentage) {
    // Only track standard milestones
    const milestones = [25, 50, 75, 100]
    if (!milestones.includes(percentage)) return

    // Don't track the same milestone twice per page
    if (this.scrollMilestones.has(percentage)) return

    this.scrollMilestones.add(percentage)

    this.addToQueue('scroll_depth', {
      depth: percentage
    })
  }

  /**
   * Flush the event queue
   * @param {boolean} useBeacon - Force use of sendBeacon (for unload)
   */
  flush(useBeacon = false) {
    if (!this.isEnabled() || !isBrowser || this.queue.length === 0) return

    const events = [...this.queue]
    this.queue = []

    const payload = JSON.stringify({
      events,
      sessionId: this.sessionId,
      sessionDuration: Date.now() - this.sessionStart
    })

    if (this.debug) {
      console.log('[Analytics] Flushing', events.length, 'events')
    }

    // Use sendBeacon for reliable delivery on page unload
    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      const sent = navigator.sendBeacon(this.endpoint, blob)

      if (!sent && this.debug) {
        console.warn('[Analytics] sendBeacon failed, events may be lost')
      }
      return
    }

    // Use fetch for normal flush
    fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true // Allows request to outlive page
    }).catch((error) => {
      if (this.debug) {
        console.warn('[Analytics] Flush failed:', error)
      }
      // Put events back in queue for retry
      this.queue.unshift(...events)
    })
  }

  /**
   * Clean up (stop interval, flush remaining events)
   */
  destroy() {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId)
    }
    this.flush(true)
  }
}
