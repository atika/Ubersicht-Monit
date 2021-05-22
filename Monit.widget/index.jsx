// Monit Ubersicht Widget
// Display your monit (https://mmonit.com/monit/) instances status on your macOS desktop with Ubersicht.
// @author      Dominique Da Silva
// @created     May 2021
// @url         https://github.com/atika/Ubersicht-Monit

import { React, run, css } from "uebersicht";
import { Parser } from "xml2js";
import { DateTime } from "luxon";

import { WidgetError, formatPing, formatBytes } from './lib/utils';

// Load user configuration
const config = require('./config.json');

// Parse monit xml with xml2js
const xmlParser = new Parser({ explicitArray: false });

// Service Types: (8)
const servicesName = ["Filesystem", "Directory", "File", "Process", "Remote Host", "System", "Fifo", "Program", "Network"];

// On reboot action
const rebootLabels = ['On', 'Off', 'Last State'];

// Display in rows or columns
const inColumn = (config.showOk === true || config.forceColumn === true);

// Remove disabled instances
config.instances = config.instances.map(instance => {
    return Array.isArray(instance) ? (
        instance.filter(elt => elt.enabled !== false)
     ) : instance.enabled !== false ? instance : null
})

// Reorganize monit instances
const _instances = config.group ? config.instances.reduce((sum, elt) => {
    if (Array.isArray(elt)) { sum.push(elt) } else { sum[0].push(elt) };
    return sum
}, [[]]) : [config.instances.flat()];

// Keep fetch date on command run
const _updatesDates = Array();

// Cache custom service list style on init
const _listStyles = [
    config.unmonitoredServices.default.style,
    null,
    config.failedServices.default.style,
    config.unmonitoredServices.noncritical.style,
    null,
    config.failedServices.noncritical.style,
]

// Current group
let _current = config.group ? -1 : 0;

export const refreshFrequency = config.refreshFrequency ?? 300000;

export const initialState = { error: new WidgetError('fetching data...', 21) }; // 21 = reload

export const init = () => {
    // Keep showOk user configuration to restore
    config['_showOk'] = config.showOk;
}

// Refresh the widget manually
// TODO: Refresh or reload widget without applescript
const refresh = () => {
    run('osascript -e \'tell application id \"tracesOf.Uebersicht\" to refresh widget id \"Monit-widget-index-jsx\"\'')
        .catch((error) => console.error(error))
}

// If the service item should be hidden
const shouldHideService = (name, type, status) => (type !== 5 && status === 1 && (config.showOk === false || (Array.isArray(config.showOk) && config.showOk.indexOf(type) === -1 && config.showOk.indexOf(name) === -1)));

// Toggle visibility of service items
const toggleVisible = (e) => {
    e.stopPropagation();
    if (config.showOk !== true) {
        // toogle icon
        for (let el of document.getElementsByClassName(classes.chevron)) {
            el.classList.remove('up');
            el.classList.add('down');
        }
        // toggle all hidden service items
        for (let el of document.getElementsByClassName(classes.hidden)) {
            if (el.tagName === 'LI')
                el.classList.remove(classes.hidden);
        }
    }
    config.showOk = config.showOk === true ? config._showOk : true;
    refresh()
}

// Style for each service list item
const listStyles = ({ status = 2, type = 0, essential = true }) => {

    const serviceOpts = config.servicesOpts[type];
    const style = {}

    if (status === 1)
        style.borderLeftColor = config.coloredIndicator ? serviceOpts.c : config.listBackgroundColor;

    // Custom user styles
    const idx = status % 4 + (essential ? 0 : 3);
    Object.assign(style, _listStyles[idx]);

    // Addition style for service type
    if (('s' in serviceOpts) && typeof serviceOpts.s === 'object') {
        Object.assign(style, serviceOpts.s);
    }

    // Dim: Define a different color for status ok
    if (config.dimOk && status === 1 && type !== 5) {
        style.color = config.dimOk;
    }

    return style
}

export const command = (dispatch) =>
    run("/usr/sbin/ioreg -c IOHIDSystem | /usr/local/bin/awk '/HIDIdleTime/ {printf \"%0.1f\",$NF/1000000000; exit}'")
        .then((idle) => {
            // Stop fetching if user is afk more than x seconds
            if (idle > config.idle) {
                return Promise.reject(new WidgetError(`Paused: User afk since ${idle > 7200 ? ((idle / 3600).toFixed(1) + ' hours') : (idle > 240 ? ((idle / 60).toFixed(1) + ' minutes') : (idle + ' seconds'))}.`, 20)); // 20 = paused
            }

            // Increment current group
            if (config.group && ++_current >= _instances.length)
                _current = 0;

            let commands = _instances[_current].map((instance, i) => {
                const insecure = instance.insecure ? '-k' : '';
                const creds = (instance.passwd && instance.passwd !== '') ? `-u "${instance.user}:${instance.passwd}"` : '';

                return run(`sleep ${0.2 * i} && curl --silent ${insecure} ${creds} "${instance.url}" | sed 's/ISO-8859-1/UTF-8/'`).finally(() => {
                    _updatesDates[i] = DateTime.now();
                })
            })
            return Promise.all(commands);
        })
        .then((docs) => Promise.all(docs.map((xml) => xml.indexOf('<?xml') === 0 ? xmlParser.parseStringPromise(xml) : null )))
        .then((data) => {
            let fails = 0;
            for (let i = 0; i < data.length; i++) {
                const instance = _instances[_current][i];
                const d = data[i];
                if (d && typeof d === 'object' && ('monit' in d)) {
                    d.id = instance.id.replace(/\s+/, '-');
                    d.url = instance.url.replace('_status?format=xml', '');
                    d.updatedAt = _updatesDates[i];
                    d.noncritical = (('noncritical' in instance) && Array.isArray(instance.noncritical)) ? instance.noncritical : [];
                    d.showStats = instance.showStats || false;
                } else {
                    data[i] = {error: new Error(instance.id + ': Fetch failed.')}
                    fails++;
                }
            }

            if (fails === _instances[_current].length) {
                throw new Error('Failed to fetch data for all of the instances!');
            }

            dispatch({ type: 'FETCH_SUCCEDED', data: data });
        })
        .catch((error) => {
            dispatch({ type: 'FETCH_FAILED', error: error });
        })

export const className = `
    left: ${config.left};
    top: ${config.top};
    border-radius: 8px;
    color: #FFF;
    font-family: Helvetica;
    font-size: 13px;

    @keyframes highlightAnim {
        30% { background: #ffb910; border-color: yellow; }
        60% { background: #ff7900; border-color: orange; }
    }
`

export const classes = {
    status:css`
        display: inline-block;
        width: 19px;
        font-size: 1.3em;
        text-align: center;
        padding:0;
        margin-right: 4px;
    `,
    s0: css`
        color: orange;
        font-size: 0.98em;
    `,
    s1: css`
        color: rgb(54, 173, 0);
    `,
    s2: css`
        color: red;
    `,
    instances: css({
        display: 'flex',
        alignItems: 'end',
        flexDirection: inColumn ? 'row' : 'column',
        maxHeight: config.maxHeight,
        overflowY: inColumn ? 'hidden' : 'scroll',
    }),
    instance: css({
        maxHeight: inColumn ? 'initial' : config.maxHeight,
        overflowY: inColumn ? 'scroll' : 'initial'
    }),
    list: css({
        listStyle: 'none',
        padding: '10px 10px 6px 10px',
        maxWidth: config.maxWidth ?? '220px',
        margin: 0,
        "& > li": {
            background: config.listBackgroundColor,
            position: 'relative',
            lineHeight: '1.2em',
            margin: 0,
            marginBottom: '-1px',
            padding: Math.max(4, 10 - config.listCompression) + 'px 8px',
            border: 'solid 1px ' + config.listBorderColor ?? '#16133c',
            borderLeft: 'solid 3px ' + config.listBackgroundColor,
            boxShadow: '0 0 8px rgba(0, 0, 0, 0.4)',
            borderRadius: '4px',
            transition: '0.8s',
            cursor: 'pointer',
            "& > .content": {
                display: 'flex',
                alignItems: 'center',
                "& > div": {
                    padding: '0 2px'
                }
            },
            "& > .infos.output": {
                maxWidth: '188px',
                color: config.listInfosColor ?? '#8e95ce'
            },
            "& > .output": {
                // maxWidth: '168px',
                fontSize: '11px',
                color: config.programOutputColor ?? '#5a65a7',
                paddingTop: '4px',
                paddingLeft: '24px',
                overflow: 'hidden',
                lineHeight: '1.2em',
                maxHeight: '2.4em',
                textOverflow: 'ellipsis',
                // whiteSpace: 'pre-line'
            },
            "&.status0, &.status2": {
                margin: '3px 0 2px 0'
            },
            "&.status0": {
                "& > .output": {
                    color: config.unmonitoredServices.default.programOutputColor ?? orange
                },
                "& > .infos.output": {
                    color: config.unmonitoredServices.default.listInfosColor ?? orange
                }
            },
            "&.status2": {
                "& > .output": {
                    color: config.failedServices.default.programOutputColor ?? red
                },
                "& > .infos.output": {
                    color: config.failedServices.default.listInfosColor ?? red
                }
            },
            "&.status0.noncritical": {
                "& > .output": {
                    color: config.unmonitoredServices.noncritical.programOutputColor ?? orange
                },
                "& > .infos.output": {
                    color: config.unmonitoredServices.noncritical.listInfosColor ?? orange
                }
            },
            "&.status2.noncritical": {
                "& > .output": {
                    color: config.failedServices.noncritical.programOutputColor ?? red
                },
                "& > .infos.output": {
                    color: config.failedServices.noncritical.listInfosColor ?? red
                }
            }
        },
        "& b": {
            color: config.color1,
        },
        "& a": {
            color: '#FFF',
            textDecoration: 'none'
        }
    }),
    highlight: css({
        animationDuration: '1.2s',
        animationName: 'highlightAnim',
        animationTimingFunction: 'ease-out'
    }),
    hidden: css({
        display: 'none'
    }),
    system_infos: css({
        color: '#FFF',
        marginLeft: '-24px',
        "& b": {
            color: '#FFF',
        },
        "& .label": {
            color: config.color2,
            lineHeight: '2.1em',
        },
        "& .number .label": {
            lineHeight: '0.9em',
        },
        "& .number": {
            display: 'inline-block',
            padding: '2px 4px',
            margin: '1px 2px 1px 0',
            border: 'solid 1px ' + config.listBorderColor,
            borderRadius: '5px',
            lineHeight: '1.2em',
            color: 'white',
            "&.hlg": {
                borderColor: config.color2
            }
        },
        "& .load .number": {
            fontSize: '1.5em',
            padding: '2px 12px'
        },
        "& .cpu": {
            fontSize: '1.1em',
            whitespace: 'nowrap',
            "& .number": {
                padding: '2px 8px'
            }
        },
        "& .dimmed": {
            color: config.programOutputColor
        },
        "& hr": {
            borderTop: 'solid 1px rgba(0,0,0,0.1)',
            borderBottom: 'solid 1px rgba(255,255,255,0.1)',
            borderLeft: 0,
            borderRight: 0,
            background: 'none',
            height: 0,
            margin: '3px 0'
        }
    }),
    stats: css({
        fontSize: '0.8em',
        lineHeight: '1.3em',
        color: '#EEEEFF'
    }),
    check: css({
        padding: '1px 4px',
        textAlign: 'right',
        borderRadius: '2px',
        backgroundColor: 'rgba(0,0,0,0.3)'
    }),
    button: css({
        padding: '2px 10px',
        border: 'solid 1px rgba(255,255,255,0.2)',
        borderRadius: '4px',
        backgroundColor: 'rgba(0,0,0,0.1)'
    }),
    chevron: css({
        display: 'block',
        transition: '0.5s',
        padding: '0 10px',
        height: '12px',
        position: 'absolute',
        right: '5px',
        top: '5px',
        cursor: 'pointer',
        zDepth: 100,
        "& i": {
            fontSize: '18px',
            fontStyle: 'normal',
            display: 'inline-block',
            marginTop: '2px'
        },
        "&.down": {
            color: 'orange',
            transform: 'rotate(180deg)'
        }
    }),
    error: css({
        fontFamily: 'monospace',
        fontSize: '0.9em',
        flexGrow: 2
    }),
    footer: css({
        fontSize: '0.8em',
        lineHeight: '1em',
        padding: '2px 12px',
        display: 'block',
        marginBottom: (config.showOk !== true && !config.forceColumn) ? '10px' : 0,
        "& b": {
            color: 'orange'
        },
        "& > span": {
            display: 'inline-block',
            padding: '2px 4px',
            flexGrow: 1
        }
    })
}

const StatusIcon = ({status}) => {
    const icons = {
        0: { cls: 's0', char: <>⭘&nbsp;</>},
        1: { cls: 's1', char: '✔' },
        2: { cls: 's2', char: '✗' },
        20: { cls: 's0', char: <>&#9616;&#9616;</>, style: { fontSize: '0.8em' } },
        21: { cls: 's1', char: '↻' }
    }
    const icon = icons[status] ?? icons[2];
    return <span className={[classes.status, classes[icon.cls]].join(' ')} style={icon.style ?? {}}>{icon.char}</span>
}

const CheckIndice = ({status}) => {
    const indiceClasses = {
        0: classes.s0,
        1: classes.s1,
        2: classes.s2
    }
    return <span className={indiceClasses[status] ?? indiceClasses[2]}>•</span>
}

const ServiceCheck = (props) => {
    const check = props.check || {};

    const result = Object.keys(check).map((key, idx) => {
        if (key === 'icmp') {
            return <div key={`icmp.${idx}`} className={classes.check}><CheckIndice status={check['icmp'].status} /> ICMP {formatPing(check['icmp'].responsetime)}</div>
        }
        if (key === 'port') {
            const ports = Object.keys(check['port']).map((num, idx2) => {
                return (
                    <div key={`port.${num}.${idx2}`} className={classes.check} title={formatPing(check['port'][num]['responsetime'])}>
                        <CheckIndice status={check['port'][num]['status']} /> {num}/{check['port'][num]['protocol']}
                    </div>
                )
            });
            return (
                <div key={`ports.${idx}`}>{ports}</div>
            )
        }
        if (key === 'hdd') {
            return <div key={`hdd.${idx}`} className={classes.check}><CheckIndice status={check['hdd'].status} /> {check['hdd']['percent']}%</div>
        }
    });

    return (
        <div className={classes.stats}>
            {result}
        </div>
    )
}

const Chevron = () => {
    const updown = config.showOk === true ? 'down' : 'up'
    return <a className={`${classes.chevron} ${updown}`} onClick={(e) => toggleVisible(e)}><i>&#8963;</i></a>
}

const SystemStats = ({load, memory}) => {
    return (typeof load === 'object') ? (
        <div>
            <span className={classes.stats}>
                <b>LOAD</b> {load.avg01}&nbsp;&nbsp;{load.avg05}&nbsp;&nbsp;{load.avg15}
                &nbsp;&nbsp;
                <b>MEM</b> {memory.percent}%
            </span>
        </div>
    ) : null;
}

const ServiceInfos = ({service}) => {
    const s = service.system;

    return (service.type === 5) ? (
        <div className={classes.system_infos}>
            <hr />
            <div className="load">
                <span className="number hlg">{s.load.avg01}</span> <span className="number hlg">{s.load.avg05}</span> <span className="number hlg">{s.load.avg15}</span>
            </div>
            <hr />
            <div className="cpu">
                <b className="label" >CPU</b> <i className="number">{s.cpu.total}x <b className="label" >{s.cpu.family}</b></i> <span className=""><i className="number">{s.cpu.user}% <b className="label">user</b></i></span>
            </div>
            <span><b className="label">sys</b> <i className="number">{s.cpu.system}%</i></span>
            {s.cpu.wait ? (<span><b className="label"> wait</b> <i className="number">{s.cpu.wait}%</i></span> ) : null }
            {s.cpu.nice ? (<span><b className="label"> nice</b> <i className="number">{s.cpu.nice}%</i></span> ) : null }
            <hr />
            <b className="label">MEMORY</b> <span className="number hlg">{s.memory.percent}% <i className="dimmed">({formatBytes(s.memory.kilobyte)})</i></span> of a memory total of <span className="number">{formatBytes(s.memory.total)}</span>  <i className="number" style={{ float: 'right' }}>{s.swap.percent}% <b className="label">swap</b></i>
        </div>
    ) : (
        service.infos
    )
}

const ServiceItem = (props) => {

    let service = props.service;
    const key = `${props.instance}.${props.idx}.${service.name}`;
    const listClasses = [];

    const [infosVisible, setInfosVisibility] = React.useState(service.status === 2 || service.showStats === true ? true : false);

    // If config.showOk is false, this part have the effect to hide
    // the service that had a bad status (0,2) only on the second cycle.
    const previousStatus = React.useRef();
    React.useEffect(() => {
        previousStatus.current = service.status;
    }, [service.status])

    const canHide = (service.status === 1 && (typeof previousStatus.current === 'undefined' || previousStatus.current === 1));
    const statusChanged = (typeof previousStatus.current === 'undefined' || service.status !== previousStatus.current);

    // Status changed
    listClasses.push(statusChanged ? classes.highlight : null);
    // Should hide this service item
    listClasses.push((canHide && shouldHideService(service.name, service.type, service.status)) ? classes.hidden : null);
    // Add a status class
    listClasses.push(`status${service.status}`);
    // Add non critical service class
    listClasses.push(service.essential ? null : 'noncritical');

    return (
        <li key={key} style={listStyles({ status: service.status, type: service.type, essential: service.essential })} className={listClasses.join(' ').trim()}
            onClick={(e) => {
                setInfosVisibility(!infosVisible);
            }}
            title={service.infos}>
            <div className="content">
                <StatusIcon status={service.status} />
                <div style={{ flexGrow: 2 }}>
                    {config.debug ? service.type + ' - ' : ''}
                    {service.name}
                    {service.type === 5 ? (
                        <>
                            <Chevron />
                            <SystemStats load={service.system.load} memory={service.system.memory} />
                        </>
                    ) : null}
                </div>
                <ServiceCheck check={service.check} />
            </div>
            <div className={`infos output ${infosVisible === true ? null : classes.hidden}`} style={{ maxHeight: 'initial' }}>
                <ServiceInfos service={service} />
            </div>
            {service.type === 7 && service.program ? (
                <div className="output">
                    <span title={service.program.output}>{service.program.output.length > 60 ? service.program.output.substring(0, 62) + '...' : service.program.output}</span>
                </div>
            ) : null}
        </li>
    )
}

const InstanceSummary = ({id, url, status, count, uptime}) => {
    return (
        <li style={{ backgroundColor: config.listBackgroundColor, borderLeft: 'solid 3px purple' }}>
            <a href={url} className="content" style={{ alignItems: 'baseline', cursor: 'pointer' }} title={`Open ${id} status page`}>
                <StatusIcon status={status} />
                <div style={{ flexGrow: 2 }}>
                    {id}<br />
                    <div className={classes.stats}>
                        {count.total} monitors&nbsp;
                        <span className={classes.s1}>✔</span>&nbsp;{count.healthy}&nbsp;&nbsp;
                        <span className={classes.s0}>⭘</span>&nbsp;&nbsp;{count.unmonitored}&nbsp;&nbsp;
                        <span className={classes.s2}>✗</span>&nbsp;{count.failed}&nbsp;
                    </div>
                </div>
                <div style={{ fontSize: '0.8em' }}>{uptime.toUpperCase()}</div>
            </a>
        </li>
    )
}

const UpdatedAt = (props) => {
    const updatedTime = props.date.toFormat('HH:mm:ss');
    const [relativeDate, setRelativeDate] = React.useState(props.date.toRelative());

    React.useEffect(() => {
        const s = setInterval(() => {
            if (config.debug) console.log('Set relative date');
            setRelativeDate(props.date.toRelative())
        }, 10000);
        setRelativeDate(props.date.toRelative())

        return () => clearInterval(s);
    }, [props.date])

    return (
        <span onMouseEnter={() => { setRelativeDate(props.date.toRelative()) }}><b>updated</b> {relativeDate} ({updatedTime})</span>
    )
}

const InstanceFooter = ({platform, version, updatedAt}) => {
    return (
        <div className={classes.footer}>
            <span>{platform.name} {platform.release}</span>
            <span style={{ float: 'right' }}>v.{version}</span><br />
            <UpdatedAt date={updatedAt} />
        </div>
    )
}

const ErrorDisplay = (props) => {

    const error = props.error;
    const date = props.date ?? DateTime.now();
    const status = 'status' in error ? error.status : 2;

    return (
        <>
            <ul className={classes.list} style={{ maxWidth: props.global ? 400 : 220 }}>
                <li style={listStyles({ status: status })}>
                    <div className="content">
                        <StatusIcon status={status} /> <span className={classes.error}>{error.message}</span>
                        <div><div className={classes.button} onClick={refresh}>refresh</div></div>
                    </div>
                </li>
            </ul>
            <div className={classes.footer} >
                <UpdatedAt date={date} />
            </div>
        </>
    )
}

// Render the widget
export const render = ({instances, error}) => {
    return error ? (
        <div>
            <ErrorDisplay global error={error} />
        </div>
    ) : (
        <div className={classes.instances}>
        {instances.map((stats, idx) => (
            stats.error ? (
                <div id={stats.id} key={idx}>
                    <ErrorDisplay error={stats.error} date={stats.updatedAt} />
                </div>
            ) : (
                <div id={stats.id} key={stats.id + '.' + idx} className={classes.instance}>
                    <ul className={classes.list}>
                        {stats.services.map((service, idx1) => (
                            <ServiceItem key={service.name}
                                service={service}
                                instance={stats.id}
                                idx={idx1} />
                        ))}
                        <InstanceSummary id={stats.id} url={stats.url} status={stats.status}
                            count={stats.server.count}
                            uptime={stats.server.uptimeRelative} />
                    </ul>
                    <InstanceFooter platform={{ name: stats.platform.name, release: stats.platform.release }}
                        version={stats.server.version}
                        updatedAt={stats.updatedAt} />
                </div>
            )
        ))}
        </div>
    )
}

const checkStatus = (item) => {
    if (Array.isArray(item)) {
        let rt = []
        for (let i of item) {
            if ('responsetime' in i) {
                rt.push(parseFloat(i['responsetime']));
            }
        }
        item[0]['responsetime'] = rt.reduce((a, b) =>  a + b) / rt.length;
        item = item[0];
    }
    return { responsetime: item.responsetime, status: (parseFloat(item['responsetime']) < 0) ? -1 : 1 };
}

const getInstanceStats = (data) => {

    const monit = data.monit;

    let globalstatus = 1;

    const statusLabels = ['Not Monitored', 'OK', 'Failed'];

    if ('error' in data) {
        return { ...data, updatedAt: DateTime.now() }
    }

    if (config.debug && config.debug === 2) console.log(data);

    let services = [];

    monit.service.forEach((service) => {
        let stats = {};

        stats['type'] = parseInt(service['$']['type']);
        stats['name'] = service.name;
        // 0:not monitored, 1: ok, 2 or more:failed
        stats['status'] = Math.min(1, parseInt(service.status)) + Math.min(1,parseInt(service.monitor));
        stats['infos'] = `${service.name.toTitleCase()} ${servicesName[stats.type]} {0} \n[ Type: ${stats.type} | On Reboot: ${rebootLabels[service.onreboot]} | Status: ${statusLabels[Math.min(2, stats.status)]} ]`
        stats['monitormode'] = service.monitormode;
        stats['check'] = {};
        stats['essential'] = !(data.noncritical.indexOf(service.name) > -1);

        const checked_at = (stats.status === 0 ? 'Not monitored since ' : 'Last check on ') + DateTime.fromSeconds(parseInt(service.collected_sec)).toLocaleString(DateTime.DATETIME_SHORT);

        switch (stats.type) {
            case 5: // system
                const sys = service.system;
                stats['system'] = sys;

                const platform = monit.platform || {};

                stats.system.cpu['total'] = parseInt(platform.cpu ?? 0);
                stats.system.cpu['family'] = platform.machine ?? 'unknow';
                stats.system.memory['total'] = parseInt(platform.memory ?? 0);
                stats.system.swap['total'] = parseInt(platform.swap ?? 0);

                let _cpuinfos = "";
                _cpuinfos += sys.cpu.user ? `${sys.cpu.user}% user ` : '';
                _cpuinfos += sys.cpu.system ? `${sys.cpu.system}% sys ` : '';
                _cpuinfos += sys.cpu.nice ? `${sys.cpu.nice}% nice ` : '';
                _cpuinfos += sys.cpu.wait ? `${sys.cpu.wait}% wait ` : '';

                stats.infos = stats.infos.format(`\nLoad ${sys.load.avg01} / ${sys.load.avg05} / ${sys.load.avg15}\n${_cpuinfos}\n${sys.memory.percent}% of memory (${formatBytes(sys.memory.kilobyte)}), ${sys.swap.percent}% of swap`);

                stats.showStats = data.showStats;
                break;
            case 0: // filesystem
                const block = service.block;
                stats['check']['hdd'] = block;
                stats['check']['hdd']['status'] = stats['status'];
                stats['infos'] = stats.infos.format(`\n${block.percent}% (${formatBytes(block.usage * 1024)} of ${formatBytes(block.total * 1024)}) [${service.fstype.toUpperCase()}]`);
                break;
            case 1: // directory
                const modified = DateTime.fromSeconds(parseInt(service.timestamps.modify)).setLocale('en-gb').toLocaleString(DateTime.DATETIME_SHORT);
                stats.infos = stats.infos.format(`(uid/gid ${service.uid}:${service.gid} mode 0${service.mode})\nLast modified on ${modified}.`)
            case 3: // process
                const service_uptime = DateTime.now().minus({seconds: service.uptime}).toRelative().replace(' ago','');
                stats.infos = stats.infos.format((stats.status === 1 && ('cpu' in service)) ? `(uptime ${service_uptime})\nCPU ${service.cpu.percent}% MEMORY ${service.memory.percent}% (${formatBytes(service.memory.kilobytetotal)}).` : `\n${checked_at}`);
                break;
            case 7: // program
                stats['program'] = service.program || {output: 'Initializing', status: '-1'};
                stats.infos = stats.infos.format(`(status ${service.program.status})`);
                break;
            default:
                stats.infos = stats.infos.format(`\n${checked_at}`);
                break
        }

        if ('icmp' in service) {
            stats['check']['icmp'] = checkStatus(service['icmp'])
        }

        if ('port' in service) {
            if (!Array.isArray(service['port']))
                service['port'] = [service['port']];

            stats['check']['port'] = {};

            for (let port of service['port']) {
                let nb = port['portnumber'];
                stats['check']['port'][nb] = {
                    responsetime: port['responsetime'],
                    protocol: port['protocol'],
                    type: port['type'],
                    hostname: port['hostname'],
                    status: checkStatus(port).status
                }
            }
        }

        if (stats['status'] !== 1 && globalstatus !== 2) {
            globalstatus = stats['status']
        }

        if (stats.status === 0) {
            const showInfos = config.showUnmonitoredInfos;
            stats.showStats = (showInfos === 1 || showInfos === true || (showInfos === 2 && stats.essential));
        }

        if (config.debug && stats.name === 'wifi') {
            stats.status = Math.ceil(Math.random()*2);
        }

        services.push(stats);
    });

    if (config.debug) console.log(services);

    // order services list
    if (config.ordered !== false) {
        let order = config.servicesOpts;
        services.sort((a, b) => order[a.type]['p'] - order[b.type]['p']);
    }

    // service and status count
    const totals = {
        total: services.length,
        healthy: 0,
        unmonitored: 0,
        failed: 0
    }
    for (let service of services) {
        switch (service.status) {
            case 0: totals.unmonitored++; break;
            case 1: totals.healthy++; break;
            default: totals.failed++; break;
        }
    }
    monit.server['count'] = totals;

    // relative uptime
    monit.server['uptimeRelative'] = DateTime.fromSeconds(DateTime.now().toSeconds() - parseInt(monit.server.uptime)).toRelative().replace(' ago','');

    return {
        id: data.id,
        url: data.url,
        platform: monit.platform,
        server: monit.server,
        services: services,
        status: globalstatus,
        updatedAt: data.updatedAt
    };
}

export const updateState = (event, previousState) => {
    if (event.error) {
        return { ...previousState, error: event.error }
    }
    if (event.type === 'FETCH_SUCCEDED') {
        let all_stats = event.data.map((data) => getInstanceStats(data));
        return {
            instances: all_stats
        }
    }
    return previousState;
}

// monitor
// 0: Off
// 1: On
// 2: Initializing
// 3: Waiting

// monitormode
// 0: Active
// 1: Passive
// 2: Manual