// --- External imports
import validUrl from 'valid-url'
import gql from 'graphql-tag'

// --- Internal imports
import { Codes } from './enums'
import createGraphQLClient from '../../createGraphQLClient'
import { stat } from 'fs'

require('dotenv').config()
const {
  createAgent,
  createEngine,
  createPlayer,
  // taskFunctions,
  listMaps
} = require('@node-sc2/core')
const { Difficulty, Race, Status } = require('@node-sc2/core/constants/enums')

const serializeException = e =>
  Object.keys(e).length ? JSON.stringify(e) : e.toString()

// --- Simulation state management
let simulationState = null

const newSimulationState = () => ({
  config: null,
  engine: null,
  episode: 0,
  step: 0,
  agents: [],
  status: newStatus()
})

const getSimulationState = () => {
  let state = simulationState
  if (!state) {
    state = newSimulationState()
    setSimulationState({ state })
  }
  return state
}

const setSimulationState = ({ state }) => {
  simulationState = state
  return state
}

const resetSimulationState = () =>
  setSimulationState({ state: newSimulationState() })

// Safely extract last status from state
const newStatus = () => ({
  id: new Date(),
  code: { id: Codes.Unknown },
  errors: []
})

const getStatus = () => {
  const state = getSimulationState()
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
  const state = getSimulationState()
  state.status = validStatus
  return validStatus
}

const setStatusCode = code => setStatus({ code: { id: code } })

const setError = error =>
  setStatus({ code: { id: Codes.Error }, errors: [error] })

const setException = exception => setError(serializeException(exception))

// --- StarCraft

const getEngine = ({ host, port } = { host: '127.0.01', port: '5000' }) => {
  const state = getSimulationState()
  let engine = state.engine
  if (!engine) {
    console.log('getEngine: creating engine...')
    engine = createEngine({ host, port })
    console.log('... engine:', state.engine)
    state.engine = engine
  }
  return engine
}

const sendOnStepMutation = async ({
  client,
  state,
  lastReward,
  lastAction,
  isDone,
  context
}) => {
  try {
    const OnStepMutation = gql`
      mutation onStep(
        $state: [Float!]!
        $lastReward: [Float!]!
        $lastAction: [Float!]!
        $isDone: Boolean!
        $context: String
      ) {
        onStep(
          state: $state
          lastReward: $lastReward
          lastAction: $lastAction
          isDone: $isDone
          context: $context
        ) {
          id
          action
          context
        }
      }
    `

    const res = await client.mutate({
      mutation: OnStepMutation,
      variables: { state, lastReward, lastAction, isDone, context }
    })

    if (res && res.data && res.data.onStep) {
      return res.data.onStep
    }
  } catch (e) {
    console.log('Exception onStep: ', JSON.stringify(e, null, 2))
    setException(e)
  }
}

const newAgent = ({ settings, index }) => {
  let client
  let agent
  const { race, uri, token } = settings
  if (validUrl.isUri(uri)) {
    console.log('new agent', uri)
    client = createGraphQLClient({ uri, token })

    agent = createAgent({
      async onGameStart({ resources }) {
        // console.log('onGameStart', resources)
        setStatusCode(Codes.Running)

        // Initialize game state for this agent
        const state = getSimulationState()
        const agentState = state.agents[index]

        const stats = {
          lastAction: [0.0],
          lastReward: [0.0],
          totalReward: [0.0]
        }
        agentState.stats = stats

        // const { units, actions, map, frame } = resources.get()
        // agentClient.query(OnResetMutation, ...)

        agentState.context = null // result of call to Agent
      },

      async onStep({ agent, resources }) {
        // console.log('onStep', agent, resources.get())
        const { units, actions, map, frame } = resources.get()

        const state = getSimulationState()

        const frameObservation = frame.getObservation()
        // console.log('frameObservation', frameObservation)

        state.step = frameObservation.gameLoop

        const agentState = state.agents[index]
        const { client, stats, context } = agentState
        const { lastReward, lastAction } = stats

        // ask the agent what action to take
        const res = await sendOnStepMutation({
          client,
          state: [0.0], // TODO: game state
          lastReward,
          lastAction,
          isDone: false,
          context
        })

        // store the actions and updated context
        stats.lastAction = res.action
        agentState.context = res.context

        // take action

        // determine reward (if any)
        stats.lastReward = [0.0]
        stats.totalReward = [0.0]
      }
    })
  }

  return {
    race,
    client,
    agent
  }
}

const getObservation = () => {
  const state = getSimulationState()

  const observation = {
    episode: state.episode,
    step: state.step,
    data: [],
    agentStats: state.agents.filter(x => !!x.stats).map(x => x.stats),
    status: getStatus()
  }
  // console.log('getObservation', observation)
  return observation
}

const run = async ({ config }) => {
  try {
    console.log(
      'Running StarCraft II simulation...',
      JSON.stringify(config, null, 2)
    )

    const state = resetSimulationState()

    setStatusCode(Codes.Starting)

    state.config = config

    const { environmentId, modeId, agents } = config
    // const map = environmentId
    const map = 'Ladder2019Season3/AcropolisLE.SC2Map'

    // make agent proxies for each of the specified agent settings
    state.agents = agents.map((settings, index) =>
      newAgent({ settings, index })
    )
    const validAgents = state.agents.find(a => !!a.client)
    if (!validAgents) {
      setError('Must have at least 1 valid agent URL')
    }

    // create game players, which can be agents or StarCraft's AI
    console.log('Creating players...')
    state.players = []
    state.players[0] = createPlayer(
      {
        race: state.agents[0].race,
        difficulty: Difficulty.MEDIUM
      },
      state.agents[0].agent
    )
    state.players[1] = createPlayer(
      {
        race: state.agents[1].race,
        difficulty: Difficulty.MEDIUM
      },
      state.agents[1].agent
    )
    console.log('... players:', state.players)

    // get an instance of the engine
    state.engine = getEngine({
      host: '127.0.0.1',
      port: '5000'
    })

    console.log('Connecting...')
    state.connection = await state.engine.connect()
    console.log('... connected: ', state.connection)

    console.log('Running game...')
    state.runGame = state.engine.runGame(map, state.players).then(rg => {
      console.log('runGame complete', rg)
      setStatusCode(Codes.Ended)
    })
    console.log('... runGame:', state.runGame)
  } catch (e) {
    setException(e)
  }
  return getStatus()
}

const stop = () => setStatusCode(Codes.Stopped)

// --- GraphQL resolvers

const resolver = {
  Query: {
    listEnvironments: async () => (await listMaps()).map(id => ({ id })),
    status: async () => getStatus(),
    observe: async () => getObservation()
  },
  Mutation: {
    run: async (_, { config }) => run({ config }),
    stop: async () => stop()
  }
}

// --- Exports

module.exports = {
  resolver
}
