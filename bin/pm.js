#!/usr/bin/env node
import { main } from '../src/index.ts'

process.exitCode = await main()
