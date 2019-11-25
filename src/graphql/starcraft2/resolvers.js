// --- External imports

import { Codes } from './enums'
require('dotenv').config()
const {
  createAgent,
  createEngine,
  createPlayer,
  // taskFunctions,
  listMaps
} = require('@node-sc2/core')
const { Difficulty, Race, Status } = require('@node-sc2/core/constants/enums')

// --- Internal imports
const { createGraphQLClient } = require('../../createGraphQLClient')

// --- Simulation state management
let globalSimState = null

const newSimState = () => ({
  config: null,
  engine: null,
  status: newStatus()
})

const getSimState = () => {
  let state = globalSimState
  if (!state) {
    state = newSimState()
    setSimState({ state })
  }
  return state
}

const setSimState = ({ state }) => {
  globalSimState = state
  return state
}

const resetSimState = () => setSimState({ state: newSimState() })

// Safely extract last status from state
const newStatus = () => ({
  id: new Date().toLocaleString(),
  code: Codes.Unknown,
  errors: []
})

const getStatus = () => {
  const state = getSimState()
  let status = state.status
  if (!status) {
    status = setStatus(newStatus())
  }
  return status
}

// Construct a status object
const setStatus = status => {
  const validStatus = {
    ...newStatus(),
    ...status
  }
  const state = getSimState()
  state.status = validStatus
  return validStatus
}

// --- StarCraft

const getEngine = ({ host, port } = { host: '127.0.01', port: '5000' }) => {
  const state = getSimState()
  let engine = state.engine
  if (!engine) {
    console.log('Creating engine...')
    engine = createEngine({ host, port })
    console.log('... done!')
    state.engine = engine
  }
  return engine
}

const newBotClient = ({ uri, token }) => createGraphQLClient({ uri, token })

const newAgent = bot => {
  const botClient = newBotClient(bot)
  const agent = createAgent({
    async onGameStart({ resources }) {
      // const { units, actions, map, frame } = resources.get()
      console.log('onGameStarted')
      setStatus({ code: Codes.Running })
      // botClient.query()
    },

    async onStep({ agent, resources }) {
      // const { units, actions, map, frame } = resources.get()
      // const { gameLoop } = frame.getObservation()

      // const state = getGameState({ id })
      // if (state.status === Status.IN_GAME) {
      console.log('onStep', agent)
      //   state.gameLoop = gameLoop
      //   const { client } = state.bot1
      //   const x = await client.query({ query: GET_INFO })
      //   console.log('res', x)
      // } else {
      //   console.log('onStep --- STOPPING')
      // }
    }
    // botClient.query()
  })

  return agent
}

const getObservation = () => {
  const state = getSimState()
  let observation = state.observation
  if (!observation) {
    observation = setObservation({ step: 0, data: [], rewards: [] })
  }
  return observation
}

const setObservation = observation => {
  const state = getSimState()
  state.observation = observation
  return observation
}

const run = async ({ config }) => {
  console.log('Running StarCraft II simulation...', config)

  const state = resetSimState()
  state.config = config

  const { environment, mode, bots } = config

  state.agents = bots.map(newAgent)

  const engine = getEngine({
    host: '127.0.0.1',
    port: '5000'
  })

  try {
    console.log('Connecting...')

    state.connection = await engine.connect()
    console.log('... connected: ', state.connection)

    setStatus({ code: Codes.Idle })

    const map = 'Ladder2019Season3/AcropolisLE.SC2Map'
    // const map = environment.id

    state.runGame = engine
      .runGame(map, [
        createPlayer({ race: Race.RANDOM }, state.bot1.agent),
        createPlayer({ race: Race.RANDOM, difficulty: Difficulty.MEDIUM })
      ])
      .then(rg => {
        console.log('runGame complete', rg)
        setStatus({ code: Codes.Ended })
      })
  } catch (e) {
    setStatus({ code: Codes.Error, errors: [JSON.stringify(e)] })
  }
  return getStatus()
}

const stop = () => setStatus({ code: Codes.Stopped })

const transformStatus = status => {
  const status1 = { ...status, code: { id: status.code } }
  console.log(status, status1)
  return status1
}

// --- GraphQL resolvers

const resolver = {
  Query: {
    listEnvironments: async () => (await listMaps()).map(id => ({ id })),
    status: async () => transformStatus(getStatus()),
    observe: async () => ({
      ...getObservation(),
      status: transformStatus(getStatus())
    })
  },
  Mutation: {
    run: async (_, { config }) => transformStatus(await run({ config })),
    stop: async () => transformStatus(stop())
  }
}

// --- Exports

module.exports = {
  resolver
}
