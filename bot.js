import ethers from 'ethers'
import chalk from 'chalk'
import dotenv from 'dotenv'

dotenv.config()

const config = {
  bnb: process.env.BNB_CONTRACT,
  toPurchase: process.env.TO_PURCHASE,
  amountOfBnb: process.env.AMOUNT_OF_BNB,
  factory: process.env.FACTORY,
  router: process.env.ROUTER,
  recipient: process.env.YOUR_ADDRESS,
  slippage : process.env.SLIPPAGE,
  gasPrice : ethers.utils.parseUnits(`${process.env.GWEI}`, 'gwei'),
  gasLimit : process.env.GAS_LIMIT,
  minBnb : process.env.MIN_LIQUIDITY_ADDED
}

let initialLiquidityDetected = false
let jmlBnb = 0

const wss = process.env.WSS_NODE
const mnemonic = process.env.YOUR_MNEMONIC
const tokenIn = config.bnb
const tokenOut = config.toPurchase
const provider = new ethers.providers.WebSocketProvider(wss)
const wallet = new ethers.Wallet.fromMnemonic(mnemonic)
const account = wallet.connect(provider)

const factory = new ethers.Contract(
    config.factory,
    [
        'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
    ],
    account
);
  
const router = new ethers.Contract(
    config.router,
    [
        'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
        'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
        'function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external  payable returns (uint[] memory amounts)',
        'function swapExactETHForTokens( uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    ],
    account
);
  
const erc = new ethers.Contract(
    config.bnb,
    [{"constant": true,"inputs": [{"name": "_owner","type": "address"}],"name": "balanceOf","outputs": [{"name": "balance","type": "uint256"}],"payable": false,"type": "function"}],
    account
);

const run = async () => {
    await checkLiq()
}

let checkLiq = async() => {
    const pairAddressx = await factory.getPair(tokenIn, tokenOut)
    console.log(chalk.blue(`pairAddress: ${pairAddressx}`))
    if (pairAddressx !== null && pairAddressx !== undefined) {
        if (pairAddressx.toString().indexOf('0x0000000000000') > -1) {
            console.log(chalk.cyan(`pairAddress ${pairAddressx} not detected. Auto restart`))
            return await run()
        }
    }
    const pairBnbValue = await erc.balanceOf(pairAddressx)
    jmlBnb = ethers.utils.formatEther(pairBnbValue)
    console.log('value BNB:', jmlBnb)

    if(parseFloat(jmlBnb) > parseFloat(config.minBnb)){
        console.log('initiating buy...')
        setTimeout(() => buyAction(), 3000)
    }
    else{
        initialLiquidityDetected = false
        console.log('run again...')
        return await run()
    }
}

let buyAction = async() => {
    if(initialLiquidityDetected === true) {
        console.log('already bought')
        return null
    }

    console.log('ready to buy')
    try {
        initialLiquidityDetected = true

        let amountOutMin = 0
        const amountIn = ethers.utils.parseUnits(`${config.amountOfBnb}`, 'ether')
        if ( parseInt(config.slippage) !== 0 ){
            const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut])
            amountOutMin = amounts[1].sub(amounts[1].div(`${config.slippage}`))
        }

        console.log(
        chalk.green.inverse('Start to buy \n')
        +
        `Buying Token
        =================
        tokenIn: ${(amountIn * 1e-18).toString()} ${tokenIn} (BNB)
        tokenOut: ${amountOutMin.toString()} ${tokenOut}
        `);

        console.log('Processing Transaction.....')
        console.log(chalk.yellow(`amountIn: ${(amountIn * 1e-18)} ${tokenIn} (BNB)`))
        console.log(chalk.yellow(`amountOutMin: ${amountOutMin}`))
        console.log(chalk.yellow(`tokenIn: ${tokenIn}`))
        console.log(chalk.yellow(`tokenOut: ${tokenOut}`))
        console.log(chalk.yellow(`config.recipient: ${config.recipient}`))
        console.log(chalk.yellow(`config.gasLimit: ${config.gasLimit}`))
        console.log(chalk.yellow(`config.gasPrice: ${config.gasPrice}`))

        const tx = await router.swapExactETHForTokens(
            amountOutMin,
            [tokenIn, tokenOut],
            config.recipient,
            Date.now() + 1000 * 60 * 5, //5 minutes
            {
                'gasLimit': config.gasLimit,
                'gasPrice': config.gasPrice,
                'nonce' : null,
                'value' : amountIn
            })

        const receipt = await tx.wait()
        console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`)
        setTimeout(() => {process.exit()},2000)
    } catch(err) {
        console.log(err)
    }
}

run()
