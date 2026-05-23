function daysBetween(a: string, b: string): number {
  const d1 = new Date(a), d2 = new Date(b)
  return Math.abs(Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)))
}

const healthSchedule = [
  { date: '2026-05-25', name: '逆龄女神瑜伽+五禽戏晨练(5/25)', type: 'real', grade: 'A', line: 'health', assigned: [
    {cat:'太极A', count:110600, range:'2026.1.26-5.10'},
    {cat:'气血调理', count:46604, range:'2026.1.26-5.10'},
    {cat:'太极BCD', count:92015, range:'2025.10.27-2026.1.25'},
    {cat:'太极s', count:28570, range:'2025.10.27-2026.1.25'},
    {cat:'固气活血', count:3307, range:'2025.10.27-2026.1.25'},
    {cat:'美学', count:995, range:'2025.10.27-2026.1.25'},
    {cat:'睡眠调理', count:34228, range:'2025.4.28-2025.10.26'},
  ]},
  { date: '2026-05-26', name: '【数字人】开心太极', type: 'real', grade: 'B', line: 'health', assigned: [
    {cat:'亚健康管理', count:14882, range:'2026.1.26-5.10'},
  ]},
  { date: '2026-05-27', name: '君合太极晨练', type: 'real', grade: 'S', line: 'health', assigned: [
    {cat:'太极BCD', count:187741, range:'2026.1.26-5.10'},
    {cat:'美学', count:7478, range:'2026.1.26-5.10'},
    {cat:'健康营养', count:24135, range:'2025.10.27-2026.1.25'},
    {cat:'太极A', count:57847, range:'2025.4.28-2025.10.26'},
    {cat:'气血调理', count:57939, range:'2025.4.28-2025.10.26'},
    {cat:'五禽戏', count:26627, range:'2025.4.28-2025.10.26'},
    {cat:'太极s', count:93761, range:'2023.1-2025.4.27'},
  ]},
  { date: '2026-05-29', name: '睡眠调理晨练', type: 'real', grade: 'A', line: 'health', assigned: [
    {cat:'睡眠调理', count:34010, range:'2026.1.26-5.10'},
    {cat:'太极A', count:34478, range:'2025.10.27-2026.1.25'},
    {cat:'五禽戏', count:6731, range:'2025.10.27-2026.1.25'},
    {cat:'太极s', count:36862, range:'2025.4.28-2025.10.26'},
    {cat:'美学', count:2585, range:'2025.4.28-2025.10.26'},
    {cat:'太极BCD', count:287932, range:'2023.1-2025.4.27'},
    {cat:'气血调理', count:97402, range:'2023.1-2025.4.27'},
  ]},
  { date: '2026-05-29', name: '健康营养', type: 'real', grade: 'S', line: 'health', assigned: [
    {cat:'健康营养', count:58391, range:'2026.1.26-5.10'},
    {cat:'五禽戏', count:11907, range:'2026.1.26-5.10'},
    {cat:'气血调理', count:24887, range:'2025.10.27-2026.1.25'},
    {cat:'亚健康管理', count:4, range:'2025.10.27-2026.1.25'},
    {cat:'固气活血', count:7014, range:'2025.4.28-2025.10.26'},
  ]},
  { date: '2026-05-29', name: '【伪直播】居家古法', type: 'fake', grade: 'S', line: 'health', assigned: [
    {cat:'太极s', count:153621, range:'2026.1.26-5.10'},
    {cat:'固气活血', count:23, range:'2026.1.26-5.10'},
    {cat:'睡眠调理', count:17868, range:'2025.10.27-2026.1.25'},
    {cat:'太极BCD', count:162462, range:'2025.4.28-2025.10.26'},
    {cat:'健康营养', count:33652, range:'2025.4.28-2025.10.26'},
    {cat:'亚健康管理', count:202, range:'2025.4.28-2025.10.26'},
    {cat:'太极A', count:100881, range:'2023.1-2025.4.27'},
  ]},
]

// 按range+品类分组，看3日频控冲突
const usage: Record<string, Array<{date: string, name: string, count: number}>> = {}
healthSchedule.forEach(live => {
  live.assigned.forEach(a => {
    const key = a.cat + ' | ' + a.range
    if (!usage[key]) usage[key] = []
    usage[key].push({date: live.date, name: live.name, count: a.count})
  })
})

console.log('=== Health线 3日频控审计 ===')
Object.entries(usage).forEach(([key, usages]) => {
  if (usages.length > 1) {
    const conflicts: string[] = []
    for (let i = 0; i < usages.length; i++) {
      for (let j = i + 1; j < usages.length; j++) {
        const d = daysBetween(usages[i].date, usages[j].date)
        if (d < 3) conflicts.push(`${usages[i].name}(${usages[i].date}) vs ${usages[j].name}(${usages[j].date}) = ${d}天`)
      }
    }
    if (conflicts.length > 0) {
      console.log('\n冲突:', key, '总人次', usages.reduce((s, u) => s + u.count, 0))
      conflicts.forEach(c => console.log('  ', c))
    }
  }
})

// 同日去重审计
console.log('\n=== Health线 同日去重审计 ===')
const dateGroups: Record<string, typeof healthSchedule> = {}
healthSchedule.forEach(live => {
  if (!dateGroups[live.date]) dateGroups[live.date] = []
  dateGroups[live.date].push(live)
})
Object.entries(dateGroups).forEach(([date, lives]) => {
  if (lives.length > 1) {
    const allCats: Record<string, string[]> = {}
    lives.forEach(l => {
      l.assigned.forEach(a => {
        const key = a.cat + ' | ' + a.range
        if (!allCats[key]) allCats[key] = []
        allCats[key].push(l.name)
      })
    })
    const dupes = Object.entries(allCats).filter(([k, v]) => v.length > 1)
    if (dupes.length > 0) {
      console.log(`\n${date} 同日冲突:`, lives.map(l => l.name).join(', '))
      dupes.forEach(([k, v]) => console.log('  ', k, '->', v.join(', ')))
    } else {
      console.log(`${date} 无同日冲突`)
    }
  }
})

// 各直播family统计
console.log('\n=== 各直播品类族分布 ===')
healthSchedule.forEach(live => {
  const families = new Set(live.assigned.map(a => a.cat.replace(/[SABCD]|【.*?】/g, '').trim()))
  console.log(live.name, 'exposure', live.assigned.reduce((s, a) => s + a.count, 0).toLocaleString(), 'families', families.size, Array.from(families).join(', '))
})

// 健康营养缺口分析
console.log('\n=== 健康营养(S) 缺口分析 ===')
const jkAssigned = healthSchedule.find(l => l.name === '健康营养')!.assigned
const jkFamilies = new Set(jkAssigned.map(a => a.cat.replace(/[SABCD]|【.*?】/g, '').trim()))
console.log('当前family数:', jkFamilies.size, Array.from(jkFamilies).join(', '))
console.log('当前exposure:', jkAssigned.reduce((s,a)=>s+a.count,0).toLocaleString())
console.log('距离50万缺口:', (500000 - jkAssigned.reduce((s,a)=>s+a.count,0)).toLocaleString())
console.log('已用段数:', jkAssigned.length, '/ 8')
console.log('剩余可分配family:', 5 - jkFamilies.size)
console.log('剩余可分配段数:', 8 - jkAssigned.length)

// sleep调理分析
console.log('\n=== 睡眠调理(A) 分析 ===')
const smAssigned = healthSchedule.find(l => l.name === '睡眠调理晨练')!.assigned
const smExposure = smAssigned.reduce((s,a)=>s+a.count,0)
const smFamilies = new Set(smAssigned.map(a => a.cat.replace(/[SABCD]|【.*?】/g, '').trim()))
console.log('当前exposure:', smExposure.toLocaleString(), '目标:', 500000)
console.log('family数:', smFamilies.size, Array.from(smFamilies).join(', '))
console.log('超大段占比:', ((287932+97402)/smExposure*100).toFixed(1) + '%')
