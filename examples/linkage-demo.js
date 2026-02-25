function main() {
  return linkage(
    { initial: coord(0, -2, 0), final: coord(0, 2, 0) },
    { initial: coord(10, 0, 0, 0, 0, 0), final: coord(10, 0, 0, 0, 0, 50) }
  )
}

module.exports = { main }
