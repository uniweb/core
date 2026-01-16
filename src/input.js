/**
 * Input
 *
 * Handles input/form data within blocks.
 */

export default class Input {
  constructor(inputData) {
    this.data = inputData || {}
  }

  getData() {
    return this.data
  }
}
